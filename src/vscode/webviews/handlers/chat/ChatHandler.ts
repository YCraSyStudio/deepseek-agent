import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { GenerationCheckpointStore, HistoryManager } from "@/vscode/storage";
import { logWarning } from "@/shared/logging/Logger";
import type { ContextWindowStatus, QueuedGenerationMessage, ReferencedFile, WebviewToHandlerMessage, WorkspaceContextStatus } from "@/contracts";
import type { ToolRegistry } from "@/application/tools";
import {
  captureCurrentWorkspaceBinding,
  resolveWorkspaceContext,
} from "@/vscode/workspace";
import { ConversationState } from "@/application/chat/ConversationState";
import { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import { ResourceGovernor } from "@/application/chat/ResourceGovernor";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import type { SendMessagePayload } from "./Types";
import { SlashCommandService } from "./messaging/SlashCommandService";
import {
  transitionGenerationRun,
  type GenerationEventCallbacks,
  type GenerationRunRecord,
} from "./generation/GenerationRun";
import { GenerationExecutor } from "./generation/GenerationExecutor";
import { recoverGenerationCheckpoints } from "./generation/GenerationRecovery";
import { ConversationWorkspaceReferences } from "./session/ConversationWorkspaceReferences";
import { ConversationWorkspaceCoordinator } from "./session/ConversationWorkspaceCoordinator";
import { MessageAdmissionService } from "./messaging/MessageAdmissionService";
import {
  cancelGeneration,
  postAvailableTools,
  steerGeneration,
  syncSelectedConversation,
} from "./session/ConversationControl";
import { ChatActivityBroadcaster } from "./activity/ChatActivityBroadcaster";
import { ChatCheckpointCoordinator } from "./activity/ChatCheckpointCoordinator";
import { IncognitoSessionLifecycle } from "./session/IncognitoSessionLifecycle";
import type { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { estimatedContextWindow } from "./context/ContextWindow";
import { ManualCompaction } from "./context/ManualCompaction";

export class ChatHandler {
  private readonly conversationState: ConversationState;
  private readonly checkpointStore: GenerationCheckpointStore;
  private readonly coordinator: GenerationCoordinator<SendMessagePayload>;
  private readonly runs = new Map<string, GenerationRunRecord>();
  private readonly recoveredDrafts = new Map<string, QueuedGenerationMessage[]>();
  private readonly broadcaster: ChatActivityBroadcaster;
  private readonly checkpoints: ChatCheckpointCoordinator;
  private readonly incognito: IncognitoSessionLifecycle;
  private readonly generationEventCallbacks: GenerationEventCallbacks;
  private readonly slashCommands: SlashCommandService;
  private readonly generationExecutor: GenerationExecutor;
  private readonly workspaceReferences: ConversationWorkspaceReferences;
  private readonly workspaceCoordinator: ConversationWorkspaceCoordinator;
  private readonly messageAdmission: MessageAdmissionService;
  private readonly manualCompaction: ManualCompaction;
  private selectedConversationId?: string;
  private webviewView?: vscode.WebviewView;
  private shuttingDown = false;
  private readonly lastReplayedGeneration = new WeakMap<object, string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly historyManager: HistoryManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly headlessWebRuntime: HeadlessWebRuntime,
    private readonly settings: SettingsRepository,
    private readonly secrets: SecretStore,
    private readonly modelProviderFactory: ModelProviderFactory,
  ) {
    this.checkpointStore = new GenerationCheckpointStore(this.settings);
    this.conversationState = new ConversationState(
      this.historyManager,
      this.settings.load().historyEnabled ? "persistent" : "incognito",
    );

    this.coordinator = new GenerationCoordinator({
      idGenerator: { next: randomUUID },
      getLimit: () => this.settings.load().maxConcurrentGenerations,
      resourceGovernor: new ResourceGovernor(),
      estimateTaskBytes: (task) => Buffer.byteLength(JSON.stringify(task.payload), "utf8"),
      run: (generationId, task, signal) =>
        this.generationExecutor.executeInWorkspace(generationId, task, signal),
      onStarted: (generationId, task) => {
        this.broadcaster.post({
          type: "generationAccepted",
          generationId,
          conversationId: task.conversationId,
          clientRequestId: task.clientRequestId,
        });
        this.broadcaster.postGenerationActivity(task.conversationId, generationId, "running");
        this.broadcaster.postHistoryTransitionActivity();
      },
      onQueued: (task, position) => {
        this.broadcaster.post({ type: "messageQueued", conversationId: task.conversationId, clientRequestId: task.clientRequestId, position });
        void this.checkpoints.checkpointQueuedConversation(task.conversationId);
        this.broadcaster.postGenerationActivity(task.conversationId, undefined, "queued");
      },
      onSettled: (generationId, task) => {
        void this.checkpoints.checkpointQueuedConversation(task.conversationId);
        this.broadcaster.postGenerationActivity(task.conversationId, generationId, "settled");
        this.broadcaster.postHistoryTransitionActivity();
      },
    });

    this.broadcaster = new ChatActivityBroadcaster({
      coordinator: this.coordinator,
      recoveredDrafts: this.recoveredDrafts,
      runs: this.runs,
      getHistoryTransition: () => this.incognito.getHistoryTransition(),
      getSelectedConversationId: () => this.selectedConversationId,
      getWebviewView: () => this.webviewView,
      lastReplayedGeneration: this.lastReplayedGeneration,
    });

    this.checkpoints = new ChatCheckpointCoordinator({
      checkpointStore: this.checkpointStore,
      coordinator: this.coordinator,
      historyManager: this.historyManager,
      isIncognito: () => this.conversationState.isIncognito(),
      recoveredDrafts: this.recoveredDrafts,
      runs: this.runs,
      settings: this.settings,
    });

    this.workspaceReferences = new ConversationWorkspaceReferences({
      conversationState: this.conversationState,
      historyManager: this.historyManager,
      post: (message) => this.broadcaster.post(message),
    });

    this.incognito = new IncognitoSessionLifecycle({
      broadcaster: this.broadcaster,
      captureBinding: captureCurrentWorkspaceBinding,
      checkpointStore: this.checkpointStore,
      clearSelectedConversation: () => {
        this.selectedConversationId = undefined;
      },
      conversationState: this.conversationState,
      coordinator: this.coordinator,
      recoveredDrafts: this.recoveredDrafts,
      runs: this.runs,
      settings: this.settings,
      workspaceReferences: this.workspaceReferences,
    });

    this.generationEventCallbacks = {
      scheduleCheckpoint: (record) => this.checkpoints.schedule(record),
      checkpointImmediately: (record) => {
        void this.checkpoints.checkpoint(record, true);
      },
      postIfSelected: (record, message) => {
        if (this.selectedConversationId === record.conversationId) {
          this.broadcaster.post(message);
        }
      },
    };

    this.slashCommands = new SlashCommandService({
      context: this.context,
      conversationState: this.conversationState,
      toolRegistry: this.toolRegistry,
      getWorkspaceBinding: (conversationId) => this.workspaceReferences.getBinding(conversationId),
      getSelectedConversationId: () => this.selectedConversationId,
      settings: this.settings,
      secrets: this.secrets,
    });
    this.generationExecutor = new GenerationExecutor({
      historyManager: this.historyManager,
      activeConversationState: this.conversationState,
      toolRegistry: this.toolRegistry,
      checkpointStore: this.checkpointStore,
      runs: this.runs,
      generationEventCallbacks: this.generationEventCallbacks,
      checkpoint: (record, immediate) => this.checkpoints.checkpoint(record, immediate),
      scheduleCheckpoint: (record) => this.checkpoints.schedule(record),
      syncSelectedConversation: (state) =>
        syncSelectedConversation(
          state,
          this.selectedConversationId,
          this.conversationState,
        ),
      post: (message) => this.broadcaster.post(message),
      settings: this.settings,
      secrets: this.secrets,
      modelProviderFactory: this.modelProviderFactory,
    });

    this.workspaceCoordinator = new ConversationWorkspaceCoordinator({
      checkpointStore: this.checkpointStore,
      conversationState: this.conversationState,
      coordinator: this.coordinator,
      historyManager: this.historyManager,
      post: (message) => this.broadcaster.post(message),
      postGenerationSnapshot: () => this.broadcaster.postGenerationSnapshot(),
      recoveredDrafts: this.recoveredDrafts,
      runs: this.runs,
      workspaceReferences: this.workspaceReferences,
    });
    this.messageAdmission = new MessageAdmissionService({
      conversationState: this.conversationState,
      coordinator: this.coordinator,
      getWebview: () => this.webviewView,
      hasHistoryTransition: () => this.incognito.isTransitionActive(),
      historyManager: this.historyManager,
      isShuttingDown: () => this.shuttingDown,
      loadConversation: (conversation) => this.loadConversation(conversation),
      onConversationCreated: (conversationId) => {
        this.selectedConversationId = conversationId;
      },
      post: (message) => this.broadcaster.post(message),
      resolveWorkspaceContext,
      settings: this.settings,
      slashCommands: this.slashCommands,
      workspaceReferences: this.workspaceReferences,
    });
    this.manualCompaction = new ManualCompaction({
      conversationState: this.conversationState,
      coordinator: this.coordinator,
      getSelectedConversationId: () => this.selectedConversationId,
      hasHistoryTransition: () => this.incognito.isTransitionActive(),
      modelProviderFactory: this.modelProviderFactory,
      post: (message) => this.broadcaster.post(message),
      secrets: this.secrets,
      settings: this.settings,
    });
  }

  handle(message: WebviewToHandlerMessage, webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    switch (message.type) {
      case "sendMessage":
        void this.acceptMessage({
          text: message.text,
          modelId: message.modelId,
          reasoning: message.reasoning,
          conversationId: message.conversationId,
          workspaceRevision: message.workspaceRevision,
          referencedFiles: message.referencedFiles,
          imageAttachments: message.imageAttachments,
          clientRequestId: message.clientRequestId,
        });
        break;
      case "steerGeneration":
        steerGeneration(
          message,
          this.coordinator,
          this.runs,
          (payload) => this.acceptMessage(payload, true),
        );
        break;
      case "cancelGeneration":
        {
          const accepted = cancelGeneration(
            message.generationId,
            message.conversationId,
            this.coordinator,
            this.runs,
          );
          this.broadcaster.post({
            type: "cancelGenerationResult",
            requestId: message.requestId,
            generationId: message.generationId,
            conversationId: message.conversationId,
            status: accepted ? "accepted" : "stale",
          });
          if (accepted) {
            this.broadcaster.postGenerationActivity(message.conversationId, message.generationId, "cancelling");
          }
        }
        break;
      case "executeToolCall":
        this.runs.get(message.generationId)?.session.handleUserAction({
          toolCallId: message.toolCallId,
          action: message.action,
        });
        break;
      case "getGenerationSnapshot":
        this.broadcaster.postGenerationSnapshot();
        this.broadcaster.postAllGenerationActivity();
        this.broadcaster.replaySelectedGeneration();
        break;
      case "compactContext":
        void this.manualCompaction.compact(message.requestId, message.conversationId);
        break;
      case "consumeRecoveredDraft": {
        const drafts = this.recoveredDrafts.get(message.conversationId) ?? [];
        const remaining = drafts.filter((draft) => draft.clientRequestId !== message.clientRequestId);
        if (remaining.length > 0) {
          this.recoveredDrafts.set(message.conversationId, remaining);
        } else {
          this.recoveredDrafts.delete(message.conversationId);
        }
        void this.checkpoints.checkpointQueuedConversation(message.conversationId);
        break;
      }
      case "getAvailableTools":
        postAvailableTools(webviewView, this.toolRegistry);
        break;
      case "newConversation":
        this.conversationState.reset();
        this.selectedConversationId = undefined;
        void webviewView.webview.postMessage({ type: "newConversationReady", requestId: message.requestId });
        this.workspaceReferences.postContext(captureCurrentWorkspaceBinding());
        break;
      case "getWorkspaceContext":
        void this.getWorkspaceContext(message.conversationId).then((context) => {
          this.broadcaster.post({
            type: "workspaceContextChanged",
            requestId: message.requestId,
            conversationId: message.conversationId,
            context,
          });
        });
        break;
      case "rebindConversationWorkspace":
        void this.workspaceCoordinator.confirmAndRebind(message.conversationId, message.workspaceRevision);
        break;
      case "openConversationWorkspace":
        void this.workspaceCoordinator.open(message.conversationId);
        break;
      default:
        logWarning(`[ChatHandler] Unknown message: ${message.type}`);
    }
  }

  loadConversation(conversation: StoredConversation): ContextWindowStatus | undefined {
    if (!this.settings.load().historyEnabled) {
      return undefined;
    }
    this.conversationState.load(conversation);
    this.selectedConversationId = conversation.id;
    this.workspaceReferences.postContext(conversation.workspaceBinding);
    const config = this.settings.load();
    return estimatedContextWindow(this.conversationState, conversation.model ?? config.model, config.maxTokens);
  }

  async getWorkspaceContext(conversationId?: string): Promise<WorkspaceContextStatus> {
    return this.workspaceCoordinator.getContext(conversationId ?? this.selectedConversationId);
  }

  registerExternalContextFiles(files: ReferencedFile[]): void {
    this.workspaceReferences.registerExternalContextFiles(files);
  }

  async rebindConversationWorkspace(conversationId: string): Promise<WorkspaceContextStatus> {
    return this.workspaceCoordinator.rebind(conversationId);
  }

  async handleWorkspaceFoldersChanged(): Promise<void> {
    await this.workspaceCoordinator.handleFoldersChanged(this.selectedConversationId);
  }

  forgetConversation(id: string): boolean {
    const active = this.coordinator.getActiveForConversation(id);
    if (active) {
      this.runs.get(active.generationId)?.session.cancel();
      this.coordinator.interrupt(active.generationId, "deleted");
    }
    const forgotten = this.conversationState.forget(id);
    if (forgotten) {
      this.selectedConversationId = undefined;
    }
    return forgotten;
  }

  attachWebview(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
  }

  detachWebview(webviewView: vscode.WebviewView): void {
    if (this.webviewView === webviewView) {
      this.webviewView = undefined;
    }
  }

  async initialize(): Promise<void> {
    await recoverGenerationCheckpoints(
      this.checkpointStore,
      this.historyManager,
      this.recoveredDrafts,
      this.settings,
    );
  }

  beginHistoryTransition(
    requestId: string,
    direction: "enter-incognito" | "exit-incognito",
  ): { activeGenerations: number; queuedMessages: number } | undefined {
    return this.incognito.beginHistoryTransition(requestId, direction);
  }

  setHistoryTransitionPhase(phase: "stop-work" | "exit-incognito"): void {
    this.incognito.setHistoryTransitionPhase(phase);
  }

  cancelHistoryTransition(requestId: string): void {
    this.incognito.cancelHistoryTransition(requestId);
  }

  getPendingWorkCounts(): { activeGenerations: number; queuedMessages: number } {
    return this.incognito.getPendingWorkCounts();
  }

  hasIncognitoMessages(): boolean {
    return this.incognito.hasIncognitoMessages();
  }

  async stopPendingWork(): Promise<void> {
    await this.incognito.stopPendingWork();
  }

  async enterIncognito(requestId: string): Promise<void> {
    await this.incognito.enterIncognito(requestId);
  }

  async promoteIncognito(requestId: string): Promise<void> {
    await this.incognito.promoteIncognito(requestId);
  }

  discardIncognito(requestId: string): void {
    this.incognito.discardIncognito(requestId);
  }

  async discardIncognitoForWebviewRecreation(): Promise<void> {
    await this.incognito.discardIncognitoForWebviewRecreation();
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.manualCompaction.dispose();
    await Promise.allSettled([...this.runs.values()].map((record) => this.checkpoints.checkpoint(record, true)));
    for (const record of this.runs.values()) {
      transitionGenerationRun(record, "interrupted");
      record.session.cancel();
    }
    await this.coordinator.shutdown();
    await this.headlessWebRuntime.dispose();
    await Promise.allSettled([...this.runs.values()].map((record) => this.checkpoints.checkpoint(record, true)));
    await this.checkpointStore.flush();
  }

  async prepareConversationDeletion(id: string): Promise<void> {
    this.coordinator.clearQueue(id);
    const active = this.coordinator.getActiveForConversation(id);
    if (active) {
      this.runs.get(active.generationId)?.session.cancel();
      this.coordinator.interrupt(active.generationId, "deleted");
      await active.completion;
    }
    await this.checkpointStore.delete(id);
  }

  private async acceptMessage(payload: SendMessagePayload, front = false): Promise<void> {
    await this.messageAdmission.accept(payload, front);
  }
}

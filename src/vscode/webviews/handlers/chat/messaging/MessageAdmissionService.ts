import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { ReferencedFile, WorkspaceBinding, WorkspaceContextStatus } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SettingsRepository } from "@/application/ports";
import type { HistoryManager } from "@/vscode/storage";
import { restoreRequestedConversation } from "../session/ConversationRestoration";
import type { ConversationWorkspaceReferences } from "../session/ConversationWorkspaceReferences";
import { getErrorMessage, getWorkspaceStatusError } from "../ChatErrors";
import type { SlashCommandService } from "./SlashCommandService";
import type { SendMessagePayload } from "../Types";

interface MessageAdmissionServiceDependencies {
  conversationState: ConversationState;
  coordinator: GenerationCoordinator<SendMessagePayload>;
  getWebview: () => vscode.WebviewView | undefined;
  hasHistoryTransition: () => boolean;
  historyManager: HistoryManager;
  isShuttingDown: () => boolean;
  loadConversation: Parameters<typeof restoreRequestedConversation>[3];
  resolveWorkspaceContext: (binding: WorkspaceBinding) => WorkspaceContextStatus;
  onConversationCreated: (conversationId: string) => void;
  post: (message: Record<string, unknown>) => void;
  settings: SettingsRepository;
  slashCommands: SlashCommandService;
  workspaceReferences: ConversationWorkspaceReferences;
}

export class MessageAdmissionService {
  constructor(private readonly dependencies: MessageAdmissionServiceDependencies) {}

  async accept(payload: SendMessagePayload, front = false): Promise<void> {
    if (this.dependencies.isShuttingDown()) {
      this.reject(payload, "The extension is shutting down.");
      return;
    }
    if (this.dependencies.hasHistoryTransition()) {
      this.reject(payload, "Finish the incognito-mode decision before sending another message.");
      return;
    }
    await this.dependencies.settings.waitForPendingWrites();
    const config = this.dependencies.settings.load();
    const webviewView = this.dependencies.getWebview();
    if (!webviewView) {
      return;
    }
    if (await this.dependencies.slashCommands.handle(payload, config, webviewView)) {
      return;
    }

    const { conversationState } = this.dependencies;
    if (!conversationState.isIncognito()) {
      await restoreRequestedConversation(
        payload.conversationId,
        conversationState,
        this.dependencies.historyManager,
        this.dependencies.loadConversation,
      );
    }
    const conversationId = this.ensureConversation(payload, config.model);
    const binding = await this.dependencies.workspaceReferences.getBinding(conversationId);
    const workspaceStatus = this.dependencies.resolveWorkspaceContext(binding);
    if (workspaceStatus.state === "disconnected" || workspaceStatus.state === "changed") {
      this.reject(payload, getWorkspaceStatusError(workspaceStatus));
      this.dependencies.workspaceReferences.postContext(binding);
      return;
    }
    if (payload.workspaceRevision && payload.workspaceRevision !== binding.revision) {
      this.reject(payload, "The workspace changed. Refresh the workspace context and try again.");
      this.dependencies.workspaceReferences.postContext(binding);
      return;
    }

    let referencedFiles: ReferencedFile[] | undefined;
    try {
      referencedFiles = await this.dependencies.workspaceReferences.validateFiles(
        payload.referencedFiles,
        binding,
      );
    } catch (error: unknown) {
      this.reject(payload, getErrorMessage(error));
      return;
    }
    try {
      this.dependencies.coordinator.enqueue({
        conversationId,
        clientRequestId: payload.clientRequestId,
        queuedAt: Date.now(),
        payload: { ...payload, conversationId, referencedFiles },
      }, front);
    } catch (error: unknown) {
      this.reject(payload, getErrorMessage(error));
    }
  }

  private ensureConversation(payload: SendMessagePayload, defaultModel: string): string {
    const { conversationState, historyManager, workspaceReferences } = this.dependencies;
    const existingId = !conversationState.isIncognito()
      ? payload.conversationId ?? conversationState.getActiveConversationId()
      : conversationState.getActiveConversationId();
    if (existingId) {
      return existingId;
    }

    const conversationId = randomUUID();
    const now = Date.now();
    const workspaceBinding = historyManager.getWorkspaceBinding();
    conversationState.load({
      schemaVersion: 2,
      id: conversationId,
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      messages: [],
      model: payload.modelId || defaultModel,
      workspaceUri: workspaceBinding.uri,
      workspaceBinding,
    });
    this.dependencies.onConversationCreated(conversationId);
    workspaceReferences.postContext(workspaceBinding);
    return conversationId;
  }

  private reject(payload: SendMessagePayload, error: string): void {
    this.dependencies.post({
      type: "requestRejected",
      requestId: payload.clientRequestId,
      action: "sendMessage",
      error,
    });
  }
}

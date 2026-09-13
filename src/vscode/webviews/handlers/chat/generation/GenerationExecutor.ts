import * as vscode from "vscode";
import {
  mapReasoningEffort,
  type AppConfig,
  type PermissionSnapshot,
  type StoredToolCall,
} from "@/contracts";
import { ConversationState } from "@/application/chat/ConversationState";
import { getGenerationStopReason, type GenerationTask } from "@/application/chat/GenerationCoordinator";
import { selectGenerationTools } from "@/application/chat/GenerationToolSelection";
import { createDelegatedVisionAnalyzer } from "@/infrastructure/deepseek/provider/DelegatedVisionAnalyzer";
import { createProviderTranscript } from "@/application/chat/ProviderTranscript";
import { PartialStreamError } from "@/application/errors/PartialStreamError";
import type { ToolRegistry } from "@/application/tools";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { runWithToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import {
  createUsageAggregate,
  isOfficialDeepSeekEndpoint,
  recordUsage,
  type ProviderUsage,
} from "@/shared/usage/Usage";
import type {
  GenerationCheckpointStore,
  HistoryManager,
} from "@/vscode/storage";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";
import { extractHttpsUrls } from "@/infrastructure/browser/NetworkPolicy";
import { isCancellationError } from "@/shared/utils/Cancellation";
import {
  captureWorkspaceRunSnapshot,
  type WorkspaceRunSnapshot,
} from "@/vscode/workspace";
import { StreamEventEmitter } from "../streaming/StreamEventEmitter";
import { sendMessageStreaming } from "../streaming/Streaming";
import type { SendMessagePayload } from "../Types";
import { appendToolAvailabilityContext } from "../prompt/RuntimeContext";
import { getErrorMessage } from "../ChatErrors";
import {
  buildGenerationMessages,
  fitGenerationRequestContext,
} from "./GenerationContext";
import { recordToolCycleCompaction } from "./GenerationCompactionRecorder";
import { GenerationResultStore } from "./GenerationResultStore";
import { createGenerationRunRecord, createGenerationState } from "./GenerationRunFactory";
import { GenerationRunFinalizer } from "./GenerationRunFinalizer";
import {
  createGenerationEventSink,
  publishGenerationTerminal,
  transitionGenerationRun,
  type GenerationEventCallbacks,
  type GenerationRunRecord,
} from "./GenerationRun";

interface GenerationExecutorDependencies {
  historyManager: HistoryManager;
  activeConversationState: ConversationState;
  toolRegistry: ToolRegistry;
  checkpointStore: GenerationCheckpointStore;
  runs: Map<string, GenerationRunRecord>;
  generationEventCallbacks: GenerationEventCallbacks;
  checkpoint: (record: GenerationRunRecord, immediate: boolean) => Promise<void>;
  scheduleCheckpoint: (record: GenerationRunRecord) => void;
  syncSelectedConversation: (state: ConversationState) => void;
  post: (message: Record<string, unknown>) => void;
  settings: SettingsRepository;
  secrets: SecretStore;
  modelProviderFactory: ModelProviderFactory;
}

export class GenerationExecutor {
  private readonly resultStore: GenerationResultStore;
  private readonly finalizer: GenerationRunFinalizer;

  constructor(private readonly dependencies: GenerationExecutorDependencies) {
    this.resultStore = new GenerationResultStore({
      runs: dependencies.runs,
      syncSelectedConversation: dependencies.syncSelectedConversation,
    });
    this.finalizer = new GenerationRunFinalizer({
      checkpoint: dependencies.checkpoint,
      checkpointStore: dependencies.checkpointStore,
      generationEventCallbacks: dependencies.generationEventCallbacks,
      resultStore: this.resultStore,
      runs: dependencies.runs,
    });
  }

  async executeInWorkspace(
    generationId: string,
    task: GenerationTask<SendMessagePayload>,
    signal: AbortSignal,
  ): Promise<void> {
    const { activeConversationState, historyManager } = this.dependencies;
    const conversation = await historyManager.getById(task.conversationId) ??
      (
        activeConversationState.getActiveConversationId() === task.conversationId
          ? activeConversationState.getConversation()
          : undefined
    );

    if (signal.aborted) {
      const generationStopReason = getGenerationStopReason(signal);
      const status = generationStopReason === "user_cancelled" ? "cancelled" : "interrupted";
      this.dependencies.post({
        type: "streamDone",
        generationId,
        conversationId: task.conversationId,
        status,
        generationStopReason,
      });
      return;
    }

    try {
      const binding = conversation?.workspaceBinding ?? historyManager.getWorkspaceBinding();
      const workspaceSnapshot = captureWorkspaceRunSnapshot(binding);
      const permissionSnapshot = await this.dependencies.settings.capturePermissionSnapshot(
        vscode.workspace.isTrusted,
      );
      const workspace = createVsCodeToolWorkspace(workspaceSnapshot, {
        allowOutsideWorkspace: true,
        unrestricted: permissionSnapshot.permissionMode === "full-access",
      });
      await runWithToolWorkspaceHost(
        workspace,
        () => this.execute(generationId, task, signal, workspaceSnapshot, permissionSnapshot),
      );
    } catch (error: unknown) {
      const record = this.dependencies.runs.get(generationId);
      if (record) {
        const aborted = signal.aborted || isCancellationError(error);
        const status = getGenerationStopReason(signal) === "user_cancelled" ? "cancelled" : "interrupted";
        if (aborted) {
          if (status === "cancelled") {this.resultStore.logCompletedToolsNotRolledBack(record);}
          await this.resultStore.persistTerminalAssistant(
            record,
            task.payload.modelId,
            status,
            getGenerationStopReason(signal),
          );
          this.resultStore.transitionToTerminal(record, status);
        } else {
          transitionGenerationRun(record, "error");
        }
        await this.dependencies.checkpointStore.delete(record.conversationId).catch(() => undefined);
        publishGenerationTerminal(
          record,
          this.dependencies.generationEventCallbacks,
          aborted
            ? { type: "streamDone", status, generationStopReason: getGenerationStopReason(signal) }
            : { type: "streamError", error: getErrorMessage(error) },
        );
        this.dependencies.runs.delete(generationId);
      } else {
        this.dependencies.post({
          type: signal.aborted ? "streamDone" : "streamError",
          generationId,
          conversationId: task.conversationId,
          ...(signal.aborted
            ? {
                status: getGenerationStopReason(signal) === "user_cancelled" ? "cancelled" : "interrupted",
                generationStopReason: getGenerationStopReason(signal),
              }
            : { error: getErrorMessage(error) }),
        });
      }
    }
  }

  private async execute(
    generationId: string,
    task: GenerationTask<SendMessagePayload>,
    signal: AbortSignal,
    workspaceSnapshot: WorkspaceRunSnapshot,
    initialPermissionSnapshot: PermissionSnapshot,
  ): Promise<void> {
    const {
      activeConversationState,
      historyManager,
      runs,
      toolRegistry,
    } = this.dependencies;
    const payload = task.payload;
    const config = this.dependencies.settings.load();
    const runState = await createGenerationState({
      activeConversationState,
      config,
      historyManager,
      task,
      workspaceSnapshot,
    });
    const record = createGenerationRunRecord({
      clientRequestId: task.clientRequestId,
      config,
      conversationId: task.conversationId,
      generationId,
      initialPermissionSnapshot,
      model: payload.modelId || config.model,
      state: runState,
      toolRegistry,
    });
    const session = record.session;
    runs.set(generationId, record);
    const eventSink = createGenerationEventSink(
      record,
      this.dependencies.generationEventCallbacks,
    );
    const requestedThinkingMode = payload.reasoning !== "off";
    const requestedModel = payload.modelId || config.model;
    const apiKey = await this.dependencies.secrets.getApiKey(config.baseUrl);

    if (!apiKey) {
      throw new Error("API key is not configured. Open Settings -> API Key.");
    }

    const providerConfig: AppConfig = {
      ...config,
      apiKey,
      model: requestedModel,
      maxTokens: record.budgetManager.effectiveMaxTokens,
      thinkingMode: requestedThinkingMode,
      reasoningEffort: mapReasoningEffort(payload.reasoning),
    };
    const provider = this.dependencies.modelProviderFactory.create(providerConfig);
    const usageAggregate = createUsageAggregate(isOfficialDeepSeekEndpoint(providerConfig.baseUrl), providerConfig.model);
    const recordPrimaryUsage = (usage: ProviderUsage | undefined): void => {
      recordUsage(usageAggregate, "primary", usage, providerConfig.model);
    };
    const stream = new StreamEventEmitter(eventSink);
    const userMessage = runState.createMessage("user", payload.text, {
      generationId,
      imageAttachments: payload.imageAttachments,
    });
    record.userMessage = userMessage;
    let messages = await buildGenerationMessages({
      payload,
      config,
      eventSink,
      state: runState,
      workspaceSnapshot,
      excludedGenerationId: generationId,
      signal,
    });
    await runState.saveMessages({ messages: [userMessage], model: providerConfig.model });
    this.dependencies.syncSelectedConversation(runState);
    await this.dependencies.checkpoint(record, true);

    await eventSink.publish({
      type: "addMessage",
      message: { role: "user", content: userMessage.content, imageAttachments: userMessage.imageAttachments },
    });
    stream.showTyping();

    try {
      const imageAttachments = (payload.imageAttachments ?? [])
        .filter((attachment) => attachment.expiresAt > Date.now());
      const tools = selectGenerationTools(toolRegistry, {
        files: workspaceSnapshot.binding.capabilities.files,
        terminal: workspaceSnapshot.binding.capabilities.terminal,
        webSearchEnabled: providerConfig.webSearchEnabled,
        modelId: providerConfig.model,
        hasImageAttachments: imageAttachments.length > 0,
      });
      appendToolAvailabilityContext(
        messages,
        initialPermissionSnapshot.permissionMode,
        tools,
        workspaceSnapshot,
      );
      messages = await fitGenerationRequestContext({
        messages,
        payload,
        config: providerConfig,
        provider,
        state: runState,
        eventSink,
        workspaceSnapshot,
        generationId,
        record,
        tools,
        permissionMode: initialPermissionSnapshot.permissionMode,
        enabledTools: tools,
        signal,
        checkpoint: (run) => this.dependencies.checkpoint(run, true),
        onUsage: (phase, usage, model) => recordUsage(usageAggregate, phase, usage, model),
      });

      if (tools.length > 0) {
        const result = await session.run({
          messages,
          tools,
          providerConfig,
          eventSink,
          permissionSnapshot: initialPermissionSnapshot,
          capturePermissionSnapshot: () =>
            this.dependencies.settings.capturePermissionSnapshot(vscode.workspace.isTrusted),
          onPermissionSnapshot: (snapshot) => {
            record.permissionSnapshot = snapshot;
            this.dependencies.scheduleCheckpoint(record);
          },
          onUsage: (phase, usage, model) => recordUsage(usageAggregate, phase, usage, model),
          onTranscriptUpdate: (transcript) => {
            record.providerTranscript = transcript;
            void this.dependencies.checkpoint(record, true);
          },
          exposeReasoning: providerConfig.thinkingMode,
          signal,
          isCancelling: () => signal.aborted,
          isWorkspaceTrusted: () => vscode.workspace.isTrusted,
          generationId,
          conversationId: task.conversationId,
          trustedUserRequest: payload.text,
          authorizedUserUrls: extractHttpsUrls(payload.text),
          budgetManager: record.budgetManager,
          analyzeImages: createDelegatedVisionAnalyzer({
            attachments: imageAttachments,
            providerConfig,
            modelProviderFactory: this.dependencies.modelProviderFactory,
            usageAggregate,
          }),
          onContextCompacted: ({ estimatedTokensBefore, estimatedTokensAfter }) =>
            recordToolCycleCompaction({
              state: runState,
              generationId,
              model: providerConfig.model,
              estimatedTokensBefore,
              estimatedTokensAfter,
              syncSelectedConversation: this.dependencies.syncSelectedConversation,
            }),
        });
        if (result) {
          await this.resultStore.save({
            content: result.content,
            timeline: result.timeline,
            model: providerConfig.model,
            toolCalls: result.toolCalls as StoredToolCall[] | undefined,
            state: runState,
            generationId,
            status: signal.aborted || result.partial ? "interrupted" : "completed",
            providerTranscript: result.providerTranscript,
            usage: usageAggregate,
          });
        }
      } else {
        const result = await sendMessageStreaming({
          onUsage: recordPrimaryUsage,
          messages,
          payload,
          config: providerConfig,
          provider,
          eventSink,
          signal,
          budgetManager: record.budgetManager,
        });
        await this.resultStore.save({
          content: result.content,
          timeline: result.timeline,
          model: providerConfig.model,
          state: runState,
          generationId,
          status: "completed",
          usage: usageAggregate,
          providerTranscript: createProviderTranscript([{
            role: "assistant",
            content: result.content,
          }], "complete"),
        });
      }
    } catch (error: unknown) {
      if (error instanceof PartialStreamError) {
        const stopReason = getGenerationStopReason(signal);
        const status = stopReason === "user_cancelled" ? "cancelled" : "interrupted";
        await this.resultStore.save({
          content: error.partial.content,
          timeline: error.partial.timeline,
          model: providerConfig.model,
          state: runState,
          generationId,
          status,
          stopReason,
          usage: usageAggregate,
        });
        if (error.reason === "cancelled") {
          stream.done({ status, generationStopReason: stopReason });
        } else {
          stream.error(error.message);
        }
        return;
      }

      const cancelled = signal.aborted || isCancellationError(error);
      this.handleSendError(error, stream, signal);
      if (!cancelled) {transitionGenerationRun(record, "error");}
      if (!cancelled) {
        await runState.saveMessages({
          messages: [
            runState.createMessage("error", getErrorMessage(error), {
              generationId,
              generationStatus: "error",
            }),
          ],
          model: providerConfig.model,
        });
      }
    } finally {
      await this.finalizer.finalize({
        eventSink,
        model: providerConfig.model,
        record,
        signal,
        stream,
        usage: usageAggregate,
      });
    }
  }

  private handleSendError(error: unknown, stream: StreamEventEmitter, signal?: AbortSignal): void {
    if (signal?.aborted || isCancellationError(error)) {
      const generationStopReason = signal ? getGenerationStopReason(signal) : undefined;
      stream.done({
        status: generationStopReason === "user_cancelled" ? "cancelled" : "interrupted",
        generationStopReason,
      });
      return;
    }
    stream.error(getErrorMessage(error));
  }
}

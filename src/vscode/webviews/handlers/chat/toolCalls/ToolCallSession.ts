import type { PermissionSnapshot, ToolCall } from "@/contracts";
import type { GenerationEventSink } from "@/application/ports";
import { runToolCallCycle } from "@/application/chat/toolCall";
import { createDeepSeekToolCallModelClient } from "@/infrastructure/deepseek/provider/features/toolCall/DeepSeekToolCallModelClient";
import { logWarning } from "@/shared/logging/Logger";
import type { ToolExecutor } from "@/application/tools/ToolExecutor";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import { requestDangerConfirmation } from "./DangerConfirmation";
import { cancelPendingToolCallCycle, createPendingToolCallCycle, resolveToolCallAction } from "./PendingCycle";
import { StreamEventEmitter } from "../streaming/StreamEventEmitter";
import { executeToolCall, recordSyntheticToolError } from "./ToolExecution";
import { MutationFailureGuard } from "./MutationFailureGuard";
import type {
  PendingDangerConfirmation,
  PendingToolCallCycle,
  StoredExecution,
  ToolCallActionPayload,
  ToolCallRunOptions,
  ToolCallRunResult,
} from "./Types";
import { createProviderTranscript } from "@/application/chat/ProviderTranscript";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { reviewCommandSafety } from "@/infrastructure/deepseek/security/commandReview";
import { compactToolCycleContext } from "@/application/chat/context/ToolCycleCompaction";
import { reviewCompletion } from "@/infrastructure/deepseek/provider/features/CompletionReviewer";
import { reviewProgress } from "@/infrastructure/deepseek/provider/features/ProgressReviewer";
import { handleToolCallRunError, postFinalToolCallMessage } from "./ToolCallOutcome";

export class ToolCallSession {
  private pendingToolCallCycle: PendingToolCallCycle | null = null;
  private pendingDangerConfirmation: PendingDangerConfirmation | null = null;
  private activePermissionSnapshot?: PermissionSnapshot;
  private currentRound = 0;
  private activeEventSink?: GenerationEventSink<Record<string, unknown>>;
  private webTainted = false;
  private forceCompaction = false;
  constructor(private readonly toolExecutor: ToolExecutor) {}

  async run(options: ToolCallRunOptions): Promise<ToolCallRunResult | undefined> {
    this.activeEventSink = options.eventSink;
    this.activePermissionSnapshot = options.permissionSnapshot;
    this.webTainted = false;
    this.forceCompaction = false;
    let streamedContent = "";
    const executedToolCalls = new Map<string, StoredExecution>();
    const mutationFailureGuard = new MutationFailureGuard();
    const stream = new StreamEventEmitter(options.eventSink);

    try {
      const result = await runToolCallCycle({
        initialMessages: options.messages,
        tools: options.tools,
        model: options.providerConfig.model,
        modelClient: createDeepSeekToolCallModelClient(
          options.providerConfig.apiKey,
          options.providerConfig.baseUrl,
        ),
        executeToolCall: async (toolCall) => {
          const context = this.createExecutionContext(options, executedToolCalls);
          if (toolCall.function.name === "compact_context") {
            this.forceCompaction = true;
            return compactContextSignal(this.forceCompaction);
          }
          const blocked = mutationFailureGuard.getBlockReason(toolCall);
          if (blocked) {
            recordSyntheticToolError(toolCall, context, blocked);
            return blocked;
          }
          const result = await executeToolCall(toolCall, context);
          mutationFailureGuard.record(toolCall, executedToolCalls.get(toolCall.id));
          return result;
        },
        cycleOptions: {
          getToolsForRound: async () => {
            const snapshot = await options.capturePermissionSnapshot();
            this.activePermissionSnapshot = snapshot;
            options.onPermissionSnapshot?.(snapshot);
            return options.tools;
          },
          signal: options.signal,
          streamFinalResponse: true,
          streamToolCallRounds: hasAutomaticPermissionMode(options),
          thinkingMode: options.providerConfig.thinkingMode,
          reasoningEffort: options.providerConfig.reasoningEffort,
          maxTokens: options.providerConfig.maxTokens,
          userId: options.providerConfig.userId,
          budgetManager: options.budgetManager,
          onRecoveryStarted: () => options.eventSink.publish({
            type: "generationRecoveryStarted",
            reason: "excessive_reasoning",
            message: "The previous tool round reasoned more than necessary. Retrying once concisely.",
          }),
          reviewCompletion: (context) => reviewCompletion({
            ...context,
            providerConfig: options.providerConfig,
            signal: options.signal,
            onUsage: (usage) => options.onUsage?.("completion_review", usage, options.providerConfig.model),
          }),
          reviewProgress: (context) => reviewProgress({
            ...context,
            providerConfig: options.providerConfig,
            signal: options.signal,
            onUsage: (usage) => options.onUsage?.("progress_review", usage, options.providerConfig.model),
          }),
          onRoundStart: async (round, toolCalls) => {
            stream.toolGroup(round, toolCalls.map((toolCall) => toolCall.id));
            await this.handleRoundStart(round, toolCalls, options);
          },
          onStreamChunk: (content) => {
            streamedContent += content;
            stream.chunk(content);
          },
          onStreamReasoning: (reasoning) => {
            if (options.exposeReasoning) {
              stream.reasoning(reasoning);
            }
          },
          onUsage: (usage) => options.onUsage?.("tool_round", usage, options.providerConfig.model),
          onTranscriptUpdate: (messages, status) => {
            options.onTranscriptUpdate?.(createProviderTranscript(messages, status));
          },
          prepareRequestContext: async (messages, toolsForRound, round) => {
            const assessment = options.budgetManager.assessRequest(messages, toolsForRound);
            const forceCompaction = this.forceCompaction;
            if (!forceCompaction && assessment.status === "within_budget") {return undefined;}
            if (!options.budgetManager.canCompactAutomatically()) {
              await options.eventSink.publish({
                type: "resourceLimitReached",
                resource: "automatic_compactions",
                error: "This generation exhausted its automatic context-compaction budget. Continue in a new turn.",
              });
              throw new Error("Automatic context-compaction limit reached. Continue in a new turn.");
            }

            const compacted = compactToolCycleContext(
              options.budgetManager,
              messages,
              toolsForRound,
              options.trustedUserRequest,
              executedToolCalls.values(),
              round,
              forceCompaction,
            );
            if (!compacted) {return undefined;}
            this.forceCompaction = false;
            options.budgetManager.recordAutomaticCompaction();
            await options.onContextCompacted?.({
              estimatedTokensBefore: compacted.estimatedTokensBefore,
              estimatedTokensAfter: compacted.estimatedTokensAfter,
            });
            await options.eventSink.publish({ type: "contextCompacted" });
            return compacted.messages;
          },
          validateRequestBudget: (messages, toolsForRound) => {
            const assessment = options.budgetManager.assessRequest(messages, toolsForRound);
            if (assessment.status === "hard_limit") {
              options.budgetManager.assertRequestFitsContext(messages, toolsForRound);
            }
          },
        },
      });

      return postFinalToolCallMessage({ options, stream, result, executedToolCalls, streamedContent });
    } catch (err: unknown) {
      return handleToolCallRunError({ err, options, stream, executedToolCalls, streamedContent });
    } finally {
      this.pendingToolCallCycle = null;
      this.pendingDangerConfirmation = null;
      this.activeEventSink = undefined;
      this.activePermissionSnapshot = undefined;
      this.webTainted = false;
      this.forceCompaction = false;
    }
  }

  cancel(): void {
    if (this.pendingToolCallCycle) {
      for (const [toolCallId, toolCall] of this.pendingToolCallCycle.toolCalls) {
        if (!this.pendingToolCallCycle.resolved.has(toolCallId)) {
          void this.activeEventSink?.publish({
            type: "toolCallResult",
            toolCallId,
            toolName: toolCall.function.name,
            result: "Cancelled with the active generation.",
            isError: false,
            status: "cancelled",
          });
        }
      }
      cancelPendingToolCallCycle(this.pendingToolCallCycle);
    }
    if (this.pendingDangerConfirmation) {
      void this.activeEventSink?.publish({
        type: "toolCallResult",
        toolCallId: this.pendingDangerConfirmation.toolCall.id,
        toolName: this.pendingDangerConfirmation.toolCall.function.name,
        result: "Cancelled with the active generation.",
        isError: false,
        status: "cancelled",
      });
      this.pendingDangerConfirmation.resolve({ confirmed: false });
    }
    this.pendingToolCallCycle = null;
    this.pendingDangerConfirmation = null;
  }

  handleUserAction(payload: ToolCallActionPayload): void {
    if (this.pendingDangerConfirmation?.toolCall.id === payload.toolCallId) {
      this.pendingDangerConfirmation.resolve({
        confirmed: payload.action === "execute",
      });
      void this.activeEventSink?.publish({
        type: "toolCallActionAccepted",
        toolCallId: payload.toolCallId,
        status: payload.action === "execute" ? "running" : "rejected",
      });
      return;
    }

    if (!this.pendingToolCallCycle) {
      logWarning("[ChatHandler] No pending tool call cycle for manual execution");
      return;
    }

    const actionResult = resolveToolCallAction(this.pendingToolCallCycle, payload.toolCallId, payload.action);
    if (actionResult === "missing") {
      logWarning(`[ChatHandler] Tool call ${payload.toolCallId} not found in pending cycle`);
    } else if (actionResult === "duplicate") {
      logWarning(`[ChatHandler] Tool call ${payload.toolCallId} already resolved`);
    } else {
      void this.activeEventSink?.publish({
        type: "toolCallActionAccepted",
        toolCallId: payload.toolCallId,
        status: payload.action === "execute" ? "running" : "rejected",
      });
    }
  }

  private createExecutionContext(options: ToolCallRunOptions, executedToolCalls: Map<string, StoredExecution>) {
    return {
      toolExecutor: this.toolExecutor,
      eventSink: options.eventSink,
      executedToolCalls,
      signal: options.signal,
      autoApproveMode: this.activePermissionSnapshot?.permissionMode === "auto-approve",
      fullAccessMode: this.activePermissionSnapshot?.permissionMode === "full-access",
      conversationId: options.conversationId,
      permissionFingerprint: this.activePermissionSnapshot?.fingerprint,
      generationId: options.generationId,
      trustedUserRequest: options.trustedUserRequest,
      availableToolNames: options.tools.map((tool) => tool.function.name),
      authorizedUserUrls: options.authorizedUserUrls,
      analyzeImages: options.analyzeImages,
      isWebTainted: () => this.webTainted,
      markWebTainted: () => {this.webTainted = true;},
      isWorkspaceTrusted: options.isWorkspaceTrusted,
      getCurrentRound: () => this.currentRound,
      getPendingCycle: () => this.pendingToolCallCycle,
      requestDangerConfirmation: (
        toolCall: ToolCall,
        confirmationResult: ConfirmationRequiredResult,
        dangerOptions?: { announceStarted?: boolean; round?: number },
      ) =>
        requestDangerConfirmation({
          eventSink: options.eventSink,
          toolCall,
          confirmationResult,
          setPendingDangerConfirmation: (value) => {
            this.pendingDangerConfirmation = value;
          },
          ...dangerOptions,
        }),
      reviewDangerousCommand: (toolCall: ToolCall, confirmationResult: ConfirmationRequiredResult) =>
        reviewCommandSafety({
          toolCall,
          actionContext: confirmationResult,
          providerConfig: options.providerConfig,
          originalUserRequest: options.trustedUserRequest,
          onUsage: (usage, model) => options.onUsage?.("security_review", usage, model),
          workspaceRoot: confirmationResult.workspaceRoot ?? getToolWorkspaceHost().getRootPath?.(),
          signal: options.signal,
        }),
    };
  }

  private async handleRoundStart(round: number, toolCalls: ToolCall[], options: ToolCallRunOptions): Promise<void> {
    this.currentRound = round;
    options.eventSink.publish({ type: "toolCallStarted", toolCalls, round });

    const snapshot = this.activePermissionSnapshot ?? options.permissionSnapshot;
    const manualToolCalls = snapshot.permissionMode === "auto-approve" || snapshot.permissionMode === "full-access"
      ? []
      : toolCalls;
    if (manualToolCalls.length === 0) {
      return;
    }

    const pendingCycle = createPendingToolCallCycle(manualToolCalls, round);
    this.pendingToolCallCycle = pendingCycle;
    options.eventSink.publish({
      type: "toolCallConfirmationRequired",
      toolCalls: manualToolCalls,
      round,
      autoExecute: false,
    });

  }

}

function hasAutomaticPermissionMode(options: ToolCallRunOptions): boolean {
  return options.permissionSnapshot.permissionMode === "auto-approve" ||
    options.permissionSnapshot.permissionMode === "full-access";
}

function compactContextSignal(force: boolean): string {
  return [
    `${force ? "Compaction requested." : "Compaction not requested."}`,
    "The active tool protocol will be rolled over into a compacted continuation when the next round begins.",
    "Trust successful tool outcomes and do not repeat completed mutations.",
  ].join(" ");
}

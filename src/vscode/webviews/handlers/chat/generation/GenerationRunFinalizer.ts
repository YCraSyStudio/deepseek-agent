import type { GenerationEventSink } from "@/application/ports";
import { getGenerationStopReason } from "@/application/chat/GenerationCoordinator";
import { logInfo } from "@/shared/logging/Logger";
import {
  formatUsageSummary,
  summarizeConversationUsage,
  type UsageAggregate,
} from "@/shared/usage/Usage";
import type { GenerationCheckpointStore } from "@/vscode/storage";
import type { StreamEventEmitter } from "../streaming/StreamEventEmitter";
import type { GenerationResultStore } from "./GenerationResultStore";
import { countCompactions, measuredContextWindow } from "../context/ContextWindow";
import {
  publishGenerationTerminal,
  type GenerationEventCallbacks,
  type GenerationRunRecord,
} from "./GenerationRun";

interface GenerationRunFinalizerDependencies {
  checkpoint: (record: GenerationRunRecord, immediate: boolean) => Promise<void>;
  checkpointStore: GenerationCheckpointStore;
  generationEventCallbacks: GenerationEventCallbacks;
  resultStore: GenerationResultStore;
  runs: Map<string, GenerationRunRecord>;
}

interface FinalizeGenerationRunOptions {
  eventSink: GenerationEventSink<Record<string, unknown>>;
  model: string;
  record: GenerationRunRecord;
  signal: AbortSignal;
  stream: StreamEventEmitter;
  usage: UsageAggregate;
}

export class GenerationRunFinalizer {
  constructor(private readonly dependencies: GenerationRunFinalizerDependencies) {}

  async finalize({
    eventSink,
    model,
    record,
    signal,
    stream,
    usage,
  }: FinalizeGenerationRunOptions): Promise<void> {
    this.publishUsage(record, eventSink, usage);

    const stopReason = getGenerationStopReason(signal);
    const userCancelled = signal.aborted && stopReason === "user_cancelled";
    const interrupted = signal.aborted && !userCancelled;
    const terminalStatus = userCancelled ? "cancelled" : interrupted ? "interrupted" : undefined;

    if (terminalStatus && !this.hasPersistedAssistant(record)) {
      await this.dependencies.resultStore.save({
        content: record.content,
        timeline: record.timeline,
        toolCalls: record.toolCalls,
        generationId: record.generationId,
        status: terminalStatus,
        stopReason,
        model,
        state: record.state,
        providerTranscript: record.providerTranscript,
        usage: usage.count > 0 ? usage : undefined,
      });
    }
    if (terminalStatus) {
      stream.done({ status: terminalStatus, generationStopReason: stopReason });
    }
    if (record.checkpointTimer) {
      clearTimeout(record.checkpointTimer);
    }

    if (userCancelled) {
      await this.finalizeCancellation(record, stopReason);
    } else {
      await this.finalizeCompletion(record, interrupted, stopReason);
    }
    this.dependencies.runs.delete(record.generationId);
  }

  private publishUsage(
    record: GenerationRunRecord,
    eventSink: GenerationEventSink<Record<string, unknown>>,
    usage: UsageAggregate,
  ): void {
    if (usage.count === 0) {
      return;
    }
    eventSink.publish({
      type: "assistantUsageUpdated",
      generationId: record.generationId,
      conversationId: record.conversationId,
      usage: structuredClone(usage),
    });
    logInfo(`[usage] ${formatUsageSummary(usage)}`, undefined, {
      generationId: record.generationId,
      conversationId: record.conversationId,
    });
    const conversationUsage = summarizeConversationUsage(
      record.state.getConversation()?.messages ?? [],
      { generationId: record.generationId, usage },
    );
    eventSink.publish({
      type: "conversationUsageUpdated",
      conversationId: record.conversationId,
      usage: structuredClone(conversationUsage),
    });
    if (conversationUsage.total) {
      logInfo(`[usage:conversation] ${formatUsageSummary(conversationUsage.total)}`, undefined, {
        conversationId: record.conversationId,
      });
    }
    const contextWindow = measuredContextWindow(record.budgetManager, countCompactions(record.state));
    if (contextWindow) {
      eventSink.publish({
        type: "contextWindowUpdated",
        conversationId: record.conversationId,
        contextWindow,
      });
    }
  }

  private hasPersistedAssistant(record: GenerationRunRecord): boolean {
    return record.state.getConversation()?.messages.some(
      (message) => message.role === "assistant" && message.generationId === record.generationId,
    ) ?? false;
  }

  private async finalizeCancellation(
    record: GenerationRunRecord,
    stopReason: ReturnType<typeof getGenerationStopReason>,
  ): Promise<void> {
    this.dependencies.resultStore.logCompletedToolsNotRolledBack(record);
    this.dependencies.resultStore.transitionToTerminal(record, "cancelled");
    await this.dependencies.checkpointStore.delete(record.conversationId);
    publishGenerationTerminal(record, this.dependencies.generationEventCallbacks, {
      type: "streamDone",
      status: "cancelled",
      generationStopReason: stopReason,
    });
  }

  private async finalizeCompletion(
    record: GenerationRunRecord,
    interrupted: boolean,
    stopReason: ReturnType<typeof getGenerationStopReason>,
  ): Promise<void> {
    if (interrupted) {
      this.dependencies.resultStore.transitionToTerminal(record, "interrupted");
    }
    if ((record.status as string) === "completed" || interrupted) {
      await this.dependencies.checkpointStore.delete(record.conversationId);
    } else {
      await this.dependencies.checkpoint(record, true);
    }
    const pendingIsError = record.pendingTerminalEvent?.type === "streamError" || record.status === "error";
    publishGenerationTerminal(
      record,
      this.dependencies.generationEventCallbacks,
      pendingIsError
        ? { type: "streamError", error: String(record.pendingTerminalEvent?.error ?? "Generation failed") }
        : {
            type: "streamDone",
            status: interrupted ? "interrupted" : "completed",
            ...(interrupted ? { generationStopReason: stopReason } : {}),
          },
    );
  }
}

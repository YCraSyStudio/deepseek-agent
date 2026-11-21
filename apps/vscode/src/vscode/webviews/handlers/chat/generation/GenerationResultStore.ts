import type { AssistantTimelineEvent, StoredToolCall } from "@/contracts";
import { ConversationState } from "@/application/chat/ConversationState";
import { getGenerationStopReason } from "@/application/chat/GenerationCoordinator";
import { buildInterruptedContextContent } from "@/application/chat/InterruptedContext";
import type { ProviderTranscript } from "@/application/chat/ProviderTranscript";
import { logInfo } from "@/shared/logging/Logger";
import type { UsageAggregate } from "@/shared/usage/Usage";
import { transitionGenerationRun, type GenerationRunRecord } from "./GenerationRun";

export interface SaveAssistantResultOptions {
  content: string;
  timeline: AssistantTimelineEvent[];
  model: string;
  toolCalls?: StoredToolCall[];
  state: ConversationState;
  generationId: string;
  status: "completed" | "cancelled" | "interrupted" | "error";
  stopReason?: "user_cancelled" | "steered" | "workspace_changed" | "shutdown" | "deleted" | "history_transition";
  providerTranscript?: ProviderTranscript;
  usage?: UsageAggregate;
  error?: string;
}

interface GenerationResultStoreDependencies {
  runs: Map<string, GenerationRunRecord>;
  syncSelectedConversation: (state: ConversationState) => void;
}

export class GenerationResultStore {
  constructor(private readonly dependencies: GenerationResultStoreDependencies) {}

  async save({
    content,
    timeline,
    model,
    toolCalls,
    state,
    generationId,
    status,
    stopReason,
    providerTranscript,
    usage,
    error,
  }: SaveAssistantResultOptions): Promise<void> {
    await state.saveMessages({
      messages: [
        ...(content || timeline.length || toolCalls?.length || !error ? [state.createMessage("assistant", content, {
          timeline,
          toolCalls,
          generationId,
          generationStatus: status,
          generationStopReason: stopReason,
          contextContent: status === "completed" ? content : buildInterruptedContextContent(content, toolCalls),
          providerTranscript,
          ...(usage !== undefined ? { usage } : {}),
        })] : []),
        ...(error ? [state.createMessage("error", error, { generationId, generationStatus: "error" })] : []),
      ],
      model,
    });

    const record = this.dependencies.runs.get(generationId);
    if (record) {
      record.errorPersisted = error !== undefined;
      record.error = error;
      record.content = content;
      record.timeline = timeline;
      record.toolCalls = toolCalls ?? [];
      transitionGenerationRun(record, status);
      record.providerTranscript = providerTranscript;
    }
    this.dependencies.syncSelectedConversation(state);
  }

  async persistTerminalAssistant(
    record: GenerationRunRecord,
    model: string,
    status: "cancelled" | "interrupted",
    stopReason: ReturnType<typeof getGenerationStopReason>,
  ): Promise<void> {
    const existing = record.state.getConversation()?.messages.some(
      (message) => message.role === "assistant" && message.generationId === record.generationId,
    );
    if (existing) {return;}

    await this.save({
      content: record.content,
      timeline: record.timeline,
      toolCalls: record.toolCalls,
      model,
      state: record.state,
      generationId: record.generationId,
      status,
      stopReason,
      providerTranscript: record.providerTranscript,
    });
  }

  transitionToTerminal(record: GenerationRunRecord, status: "cancelled" | "interrupted"): void {
    if (status === "cancelled" && record.status !== "cancelling" && record.status !== "cancelled") {
      transitionGenerationRun(record, "cancelling");
    }
    transitionGenerationRun(record, status);
  }

  logCompletedToolsNotRolledBack(record: GenerationRunRecord): void {
    if (record.cancellationEffectsLogged) {
      return;
    }
    record.cancellationEffectsLogged = true;
    const completedToolCount = record.toolCalls
      .filter((toolCall) => toolCall.status === "completed").length;
    if (completedToolCount > 0) {
      logInfo(`[cancel] ${completedToolCount} completed tool effect(s) were not rolled back.`, undefined, {
        generationId: record.generationId,
        conversationId: record.conversationId,
      });
    }
  }
}

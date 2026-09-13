import type { AssistantTimelineEvent, ConversationMessage, PermissionSnapshot, StoredToolCall } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { ProviderTranscript } from "@/application/chat/ProviderTranscript";
import type { ToolCallSession } from "../toolCalls/ToolCallSession";
import { isStoredToolStatus, upsertStoredToolCall } from "../toolCalls/StoredToolCalls";
import { isDangerConfirmationData } from "@/application/chat/ConversationValidation";
import {
  transitionGenerationState,
  type GenerationStatus,
} from "@/domain/generation/GenerationState";
import type { GenerationEventSink } from "@/application/ports";
import type { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import { appendBoundedUtf8 } from "@/shared/utils/BoundedText";
import {
  captureGenerationTerminal,
  finalizeGenerationTerminal,
} from "@/domain/generation/GenerationTerminal";

const MAX_REPLAY_EVENTS = 512;
const MAX_RETAINED_REASONING_BYTES = 512 * 1024;
const REPLAY_EVENT_TYPES = new Set([
  "toolCallStarted",
  "toolCallConfirmationRequired",
  "toolCallResult",
  "toolCallActionAccepted",
]);

export interface GenerationRunRecord {
  generationId: string;
  conversationId: string;
  clientRequestId: string;
  state: ConversationState;
  session: ToolCallSession;
  userMessage?: ConversationMessage;
  content: string;
  timeline: AssistantTimelineEvent[];
  toolCalls: StoredToolCall[];
  status: GenerationStatus;
  eventLog: Array<Record<string, unknown>>;
  checkpointTimer?: ReturnType<typeof setTimeout>;
  permissionSnapshot?: PermissionSnapshot;
  providerTranscript?: ProviderTranscript;
  budgetManager: GenerationBudgetManager;
  pendingTerminalEvent?: Record<string, unknown>;
  terminalEventSent?: boolean;
  cancellationEffectsLogged?: boolean;
}

export interface GenerationEventCallbacks {
  scheduleCheckpoint: (record: GenerationRunRecord) => void;
  checkpointImmediately: (record: GenerationRunRecord) => void;
  postIfSelected: (record: GenerationRunRecord, message: Record<string, unknown>) => void;
}

export function transitionGenerationRun(record: GenerationRunRecord, next: GenerationStatus): void {
  if (record.status === "cancelling" && (next === "interrupted" || next === "error")) {
    return;
  }
  record.status = transitionGenerationState(record.status, next);
}

export function publishGenerationTerminal(
  record: GenerationRunRecord,
  callbacks: GenerationEventCallbacks,
  fallback: Record<string, unknown>,
): void {
  const message = finalizeGenerationTerminal(record, fallback);
  if (message) {
    callbacks.postIfSelected(record, message);
  }
}

export function createGenerationEventSink(
  record: GenerationRunRecord,
  callbacks: GenerationEventCallbacks,
): GenerationEventSink<Record<string, unknown>> {
  return {
    publish: (message: unknown) => {
      handleGenerationEvent(record, message, callbacks);
    },
  };
}

function handleGenerationEvent(
  record: GenerationRunRecord,
  value: unknown,
  callbacks: GenerationEventCallbacks,
): void {
  if (!value || typeof value !== "object") {
    return;
  }
  const message: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
    generationId: record.generationId,
    conversationId: record.conversationId,
  };
  if (message.type === "addMessage" && message.message && typeof message.message === "object") {
    message.message = {
      ...(message.message as Record<string, unknown>),
      generationId: record.generationId,
    };
  }
  const type = typeof message.type === "string" ? message.type : "";
  if (type === "streamDone" || type === "streamError") {
    captureGenerationTerminal(record, message);
    return;
  }
  if (type === "streamTimelineDelta" && typeof message.content === "string" && typeof message.eventId === "string") {
    record.content += message.eventType === "content" ? message.content : "";
    const existing = record.timeline.find((event) => event.id === message.eventId);
    if (existing && (existing.type === "content" || existing.type === "reasoning")) {
      existing.content = existing.type === "reasoning"
        ? appendBoundedUtf8(existing.content, message.content, MAX_RETAINED_REASONING_BYTES)
        : existing.content + message.content;
    } else if (message.eventType === "content" || message.eventType === "reasoning") {
      record.timeline.push({ id: message.eventId, type: message.eventType, content: message.content });
    }
    transitionGenerationRun(record, "streaming");
    callbacks.scheduleCheckpoint(record);
  } else if (type === "streamTimelineToolGroup" && message.event && typeof message.event === "object") {
    record.timeline.push(structuredClone(message.event) as AssistantTimelineEvent);
    transitionGenerationRun(record, "running_tool");
    callbacks.checkpointImmediately(record);
  } else if (type === "toolCallConfirmationRequired") {
    const toolCalls = Array.isArray(message.toolCalls)
      ? message.toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>
      : [];
    const dangerConfirmation = isDangerConfirmationData(message.dangerConfirmation)
      ? structuredClone(message.dangerConfirmation)
      : undefined;
    for (const toolCall of toolCalls) {
      upsertStoredToolCall(record.toolCalls, {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
        status: "awaiting_confirmation",
        requiresConfirmation: true,
        dangerLevel: dangerConfirmation?.dangerLevel,
        dangerConfirmation,
        round: typeof message.round === "number" ? message.round : undefined,
      });
    }
    transitionGenerationRun(record, "awaiting_confirmation");
    callbacks.checkpointImmediately(record);
  } else if (type === "toolCallStarted") {
    const toolCalls = Array.isArray(message.toolCalls)
      ? message.toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>
      : [];
    for (const toolCall of toolCalls) {
      upsertStoredToolCall(record.toolCalls, {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
        status: "running",
        round: typeof message.round === "number" ? message.round : undefined,
      });
    }
    transitionGenerationRun(record, "running_tool");
    callbacks.checkpointImmediately(record);
  } else if (type === "toolCallResult" && typeof message.toolCallId === "string") {
    const existing = record.toolCalls.find((tool) => tool.toolCallId === message.toolCallId);
    if (existing) {
      existing.status = isStoredToolStatus(message.status) ? message.status : "error";
      existing.result = typeof message.result === "string" ? message.result : "";
      existing.isError = message.isError === true;
      existing.requiresConfirmation = false;
      existing.dangerConfirmation = undefined;
    }
    transitionGenerationRun(record, "running_tool");
    callbacks.checkpointImmediately(record);
  } else if (type === "toolCallActionAccepted" && typeof message.toolCallId === "string") {
    const existing = record.toolCalls.find((tool) => tool.toolCallId === message.toolCallId);
    if (existing && (message.status === "running" || message.status === "rejected")) {
      existing.status = message.status;
      existing.requiresConfirmation = false;
      existing.dangerConfirmation = undefined;
    }
    transitionGenerationRun(record, "running_tool");
    callbacks.checkpointImmediately(record);
  } else if (type === "addMessage") {
    const added = message.message as { toolCalls?: StoredToolCall[] } | undefined;
    if (added?.toolCalls) {
      record.toolCalls = structuredClone(added.toolCalls);
    }
  }

  if (REPLAY_EVENT_TYPES.has(type)) {
    record.eventLog.push(message);
    if (record.eventLog.length > MAX_REPLAY_EVENTS) {
      record.eventLog.splice(0, record.eventLog.length - MAX_REPLAY_EVENTS);
    }
  }
  callbacks.postIfSelected(record, message);
}

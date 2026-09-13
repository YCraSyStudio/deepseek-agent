import type { ChatMessage, Conversation, ConversationMessage, ToolCall } from "@/contracts";
import { isRecord } from "@/shared/utils/TypeGuards";
import { isBoundedString } from "@/shared/utils/Validation";

const MAX_TRANSCRIPT_MESSAGES = 10_000;
const MAX_TRANSCRIPT_FIELD_CHARACTERS = 5 * 1024 * 1024;

export interface ProviderTranscript {
  schemaVersion: 1;
  provider: "deepseek";
  status: "complete" | "incomplete";
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | "insufficient_system_resource" | null;
  messages: ChatMessage[];
}

export interface ConversationContextSummary {
  schemaVersion: 2;
  provider: "deepseek" | "local";
  content: string;
  coveredGenerationIds: string[];
  sourceDigest: string;
  updatedAt: number;
  boundaries?: CompactionBoundary[];
}

interface CompactionBoundary {
  id: string;
  createdAt: number;
  reason: "input_soft_limit" | "tool_cycle_rollover" | "manual_recovery";
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  coveredGenerationIds: string[];
  sourceDigest: string;
}

export interface StoredConversationMessage extends ConversationMessage {
  providerTranscript?: ProviderTranscript;
  contextContent?: string;
}

export interface StoredConversation extends Omit<Conversation, "messages"> {
  messages: StoredConversationMessage[];
  contextSummary?: ConversationContextSummary;
}

export function toPresentationConversation(conversation: StoredConversation): Conversation {
  const { contextSummary: _contextSummary, messages, ...presentation } = conversation;
  return {
    ...presentation,
    messages: messages.map(({
      providerTranscript: _providerTranscript,
      contextContent: _contextContent,
      ...message
    }) => message),
  };
}

export function getFinalAssistantContent(transcript: ProviderTranscript | undefined): string | undefined {
  if (transcript?.status !== "complete") {return undefined;}
  for (let index = transcript.messages.length - 1; index >= 0; index -= 1) {
    const message = transcript.messages[index];
    if (message?.role === "assistant" && typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }
  }
  return undefined;
}

export function createProviderTranscript(
  messages: ChatMessage[],
  status: ProviderTranscript["status"],
  finishReason?: ProviderTranscript["finishReason"],
): ProviderTranscript {
  const transcript: ProviderTranscript = {
    schemaVersion: 1,
    provider: "deepseek",
    status,
    ...(finishReason !== undefined ? { finishReason } : {}),
    messages: structuredClone(messages),
  };
  if (!isProviderTranscript(transcript)) {
    throw new Error("Refusing to persist a protocol-invalid DeepSeek transcript");
  }
  return transcript;
}

export function isProviderTranscript(value: unknown): value is ProviderTranscript {
  if (!isRecord(value)) {
    return false;
  }
  return value.schemaVersion === 1 &&
    value.provider === "deepseek" &&
    (value.status === "complete" || value.status === "incomplete") &&
    (value.finishReason === undefined || value.finishReason === null || [
      "stop",
      "length",
      "tool_calls",
      "content_filter",
      "insufficient_system_resource",
    ].includes(String(value.finishReason))) &&
    Array.isArray(value.messages) &&
    value.messages.length <= MAX_TRANSCRIPT_MESSAGES &&
    value.messages.every(isProviderMessage) &&
    isProtocolOrdered(value.messages, value.status === "complete");
}

export function isConversationContextSummary(value: unknown): value is ConversationContextSummary {
  if (!isRecord(value)) {
    return false;
  }
  return value.schemaVersion === 2 &&
    (value.provider === "deepseek" || value.provider === "local") &&
    isBoundedString(value.content, MAX_TRANSCRIPT_FIELD_CHARACTERS) &&
    Array.isArray(value.coveredGenerationIds) &&
    value.coveredGenerationIds.length <= 10_000 &&
    value.coveredGenerationIds.every((id) => isBoundedString(id, 512)) &&
    isBoundedString(value.sourceDigest, 256) &&
    (value.boundaries === undefined || (
      Array.isArray(value.boundaries) &&
      value.boundaries.length <= 1_000 &&
      value.boundaries.every(isCompactionBoundary)
    )) &&
    Number.isSafeInteger(value.updatedAt) &&
    (value.updatedAt as number) >= 0;
}

function isCompactionBoundary(value: unknown): value is CompactionBoundary {
  if (!isRecord(value)) {return false;}
  return isBoundedString(value.id, 512) &&
    Number.isSafeInteger(value.createdAt) && (value.createdAt as number) >= 0 &&
    ["input_soft_limit", "tool_cycle_rollover", "manual_recovery"].includes(String(value.reason)) &&
    Number.isSafeInteger(value.estimatedTokensBefore) && (value.estimatedTokensBefore as number) >= 0 &&
    Number.isSafeInteger(value.estimatedTokensAfter) && (value.estimatedTokensAfter as number) >= 0 &&
    Array.isArray(value.coveredGenerationIds) &&
    value.coveredGenerationIds.length <= 10_000 &&
    value.coveredGenerationIds.every((id) => isBoundedString(id, 512)) &&
    isBoundedString(value.sourceDigest, 256);
}

export function sanitizeStoredTranscript(value: unknown): ProviderTranscript | undefined {
  return isProviderTranscript(value) ? structuredClone(value) : undefined;
}

function isProviderMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || !isMessageRole(value.role)) {
    return false;
  }
  if (value.content !== null && !isBoundedString(value.content, MAX_TRANSCRIPT_FIELD_CHARACTERS)) {
    return false;
  }
  if (value.reasoning_content !== undefined && value.reasoning_content !== null &&
    !isBoundedString(value.reasoning_content, MAX_TRANSCRIPT_FIELD_CHARACTERS)) {
    return false;
  }
  if (value.tool_call_id !== undefined && !isBoundedString(value.tool_call_id, 512)) {
    return false;
  }
  if (value.name !== undefined && !isBoundedString(value.name, 256)) {
    return false;
  }
  return value.tool_calls === undefined ||
    (Array.isArray(value.tool_calls) && value.tool_calls.length <= 1_000 && value.tool_calls.every(isToolCall));
}

function isToolCall(value: unknown): value is ToolCall {
  if (!isRecord(value) || !isBoundedString(value.id, 512) || value.type !== "function" || !isRecord(value.function)) {
    return false;
  }
  if (!isBoundedString(value.function.name, 256) ||
    !isBoundedString(value.function.arguments, MAX_TRANSCRIPT_FIELD_CHARACTERS)) {
    return false;
  }
  try {
    JSON.parse(value.function.arguments);
    return true;
  } catch {
    return false;
  }
}

function isProtocolOrdered(messages: ChatMessage[], requireFinalAssistant: boolean): boolean {
  const knownToolCallIds = new Set<string>();
  let pendingToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      if (pendingToolCallIds.size > 0) {
        return false;
      }
      const toolCalls = message.tool_calls ?? [];
      pendingToolCallIds = new Set<string>();
      for (const toolCall of toolCalls) {
        if (knownToolCallIds.has(toolCall.id) || pendingToolCallIds.has(toolCall.id)) {
          return false;
        }
        knownToolCallIds.add(toolCall.id);
        pendingToolCallIds.add(toolCall.id);
      }
      continue;
    }

    if (message.role === "tool") {
      if (!message.tool_call_id || !pendingToolCallIds.delete(message.tool_call_id)) {
        return false;
      }
      continue;
    }

    return false;
  }

  if (pendingToolCallIds.size > 0) {
    return !requireFinalAssistant;
  }
  if (!requireFinalAssistant) {
    return true;
  }
  const finalMessage = messages.at(-1);
  return finalMessage?.role === "assistant" && (finalMessage.tool_calls?.length ?? 0) === 0;
}

function isMessageRole(value: unknown): value is ChatMessage["role"] {
  return value === "assistant" || value === "tool";
}


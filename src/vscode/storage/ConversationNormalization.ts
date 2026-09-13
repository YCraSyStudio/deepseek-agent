import type { Conversation, ConversationSummary } from "@/contracts";
import { createConversationTitle } from "@/application/chat/ConversationTitle";
import {
  getFinalAssistantContent,
  sanitizeStoredTranscript,
  type StoredConversation,
} from "@/application/chat/ProviderTranscript";

export function normalizeConversation(conversation: StoredConversation): StoredConversation {
  const messages = conversation.messages.map((message) => {
    const providerTranscript = sanitizeStoredTranscript(message.providerTranscript);
    const completedContext = message.role === "assistant" && providerTranscript?.status === "complete"
      ? message.contextContent ?? getFinalAssistantContent(providerTranscript) ?? message.content ?? ""
      : message.contextContent;
    return {
      ...message,
      content: message.content,
      toolCalls: message.toolCalls?.map(normalizeToolCall),
      timeline: message.timeline ?? undefined,
      contextContent: completedContext,
      providerTranscript: providerTranscript?.status === "complete" ? undefined : providerTranscript,
    };
  });
  return {
    ...conversation,
    schemaVersion: 2,
    workspaceUri: conversation.workspaceBinding.uri,
    title: createConversationTitle(messages, conversation.title),
    messages,
    contextSummary: conversation.contextSummary
      ? structuredClone(conversation.contextSummary)
      : undefined,
  };
}

export function toConversationSummary(
  conversation: StoredConversation,
  sizeBytes: number,
): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    model: conversation.model,
    messageCount: conversation.messages.length,
    sizeBytes,
    workspaceUri: conversation.workspaceUri,
  };
}

function normalizeToolCall<T extends NonNullable<Conversation["messages"][number]["toolCalls"]>[number]>(toolCall: T): T {
  if (toolCall.status === "pending" || toolCall.status === "awaiting_confirmation" || toolCall.status === "running") {
    return {
      ...toolCall,
      status: "cancelled",
      result: toolCall.result ?? "Interrupted because the extension host stopped.",
      isError: false,
      requiresConfirmation: false,
      dangerConfirmation: undefined,
    };
  }
  if (toolCall.result && isWebTool(toolCall.toolName) && toolCall.result.length > 8 * 1024) {
    return {
      ...toolCall,
      result: `${toolCall.result.slice(0, 8 * 1024 - 32)}\n[Web result compacted]`,
    };
  }
  return toolCall;
}

function isWebTool(name: string): boolean {
  return name === "search_web" || name === "read_web";
}

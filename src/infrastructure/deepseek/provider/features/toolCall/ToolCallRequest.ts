import { DEFAULT_CONFIG, type AppConfig, type ChatMessage, type ToolDefinition } from "@/contracts";
import { buildChatBody, type ChatRequest } from "../Chat";
import type { ToolCallCycleOptions } from "@/application/chat/toolCall/ToolCallTypes";

interface BuildToolCallRequestOptions {
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  stream: boolean;
  cycleOptions: ToolCallCycleOptions;
}

export function buildToolCallRequest(options: BuildToolCallRequestOptions): ChatRequest {
  const { model, messages, tools, stream, cycleOptions } = options;
  const baseRequest: Partial<ChatRequest> = {
    model,
    messages,
    stream,
    ...(tools.length > 0 ? { tools } : {}),
    ...(cycleOptions.maxTokens !== undefined ? { max_tokens: cycleOptions.maxTokens } : {}),
    ...(cycleOptions.userId ? { user_id: cycleOptions.userId } : {}),
  };

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    model,
    thinkingMode: cycleOptions.thinkingMode ?? true,
    reasoningEffort: cycleOptions.reasoningEffort,
    maxTokens: cycleOptions.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    userId: cycleOptions.userId,
  };

  return { ...baseRequest, ...buildChatBody(baseRequest, config) } as ChatRequest;
}

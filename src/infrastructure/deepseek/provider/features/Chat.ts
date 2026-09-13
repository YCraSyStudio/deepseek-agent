import { buildApiUrl, deepseekFetch } from "@/infrastructure/deepseek/client/DeepSeekFetch";
import { readSSEStream } from "@/infrastructure/deepseek/streaming/ReadSSEStream";
import { DEFAULT_CONFIG, type AppConfig, type ChatCompletionRequest, type ChatCompletionResponse, type StreamChunk } from "@/contracts";
import { parseChatCompletionResponse, parseStreamToolCalls } from "./ChatResponseValidation";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { isOfficialDeepSeekEndpoint, parseProviderUsage } from "@/shared/usage/Usage";
import { MAX_CHAT_RESPONSE_BYTES, readBoundedJson } from "@/infrastructure/deepseek/client/BoundedResponseJson";

interface DeepSeekChatRequest extends ChatCompletionRequest {
  user_id?: string;
}

export type ChatRequest = DeepSeekChatRequest;
export type ChatResponse = ChatCompletionResponse;
type ChatStreamChunk = StreamChunk;
const MAX_STREAM_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_REASONING_BYTES = 8 * 1024 * 1024;

export function buildChatBody(request: Partial<ChatRequest>, config: AppConfig): Partial<ChatRequest> {
  const body: Partial<ChatRequest> = {
    model: request.model || config.model || DEFAULT_CONFIG.model,
    stream: request.stream ?? true,
  };

  const thinkingEnabled = config.thinkingMode ?? DEFAULT_CONFIG.thinkingMode;
  if (thinkingEnabled) {
    body.thinking = { type: "enabled" };
    const reasoningEffort = request.reasoning_effort ?? config.reasoningEffort;
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
  } else {
    body.thinking = { type: "disabled" };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    } else {
      body.temperature = config.temperature ?? DEFAULT_CONFIG.temperature;
    }
    if (request.top_p !== undefined) {
      body.top_p = request.top_p;
    } else {
      body.top_p = config.topP ?? DEFAULT_CONFIG.topP;
    }
  }

  if (request.max_tokens !== undefined) {
    body.max_tokens = request.max_tokens;
  } else {
    body.max_tokens = config.maxTokens ?? DEFAULT_CONFIG.maxTokens;
  }
  if (request.stop) {
    body.stop = request.stop;
  }
  if (request.tools) {
    body.tools = request.tools.map((tool) => {
      const { strict: _strict, ...providerFunction } = tool.function;
      return { ...tool, function: providerFunction };
    });
  }
  if (request.tool_choice) {
    body.tool_choice = request.tool_choice;
  }
  if (request.user_id) {
    body.user_id = request.user_id;
  } else if (config.userId) {
    body.user_id = config.userId;
  }

  return body;
}

export async function chatCompletion(request: ChatRequest, apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<ChatResponse> {
  const url = buildApiUrl(baseUrl, "chat/completions");
  const response = await deepseekFetch({
    pathOrUrl: url,
    apiKey,
    baseUrl,
    requestInit: {
      method: "POST",
      body: JSON.stringify({ ...request, stream: false }),
      signal,
    },
  });
  return parseChatCompletionResponse(await readBoundedJson(response, MAX_CHAT_RESPONSE_BYTES));
}

interface ChatCompletionStreamOptions {
  request: ChatRequest;
  apiKey: string;
  baseUrl: string;
  onChunk: (chunk: ChatStreamChunk) => void;
  signal?: AbortSignal;
}

export async function chatCompletionStream(options: ChatCompletionStreamOptions): Promise<void> {
  const { request, apiKey, baseUrl, onChunk, signal } = options;
  const url = buildApiUrl(baseUrl, "chat/completions");
  let finishReason = "stop";
  let emittedDone = false;
  let contentBytes = 0;
  let reasoningBytes = 0;

  const emitDone = () => {
    if (emittedDone) {
      return;
    }
    emittedDone = true;
    onChunk({ type: "done", finish_reason: finishReason });
  };

  const response = await deepseekFetch({
    pathOrUrl: url,
    apiKey,
    baseUrl,
    requestInit: {
      method: "POST",
      body: JSON.stringify({
        ...request,
        stream: true,
        ...(isOfficialDeepSeekEndpoint(baseUrl) ? { stream_options: { include_usage: true } } : {}),
      }),
      signal,
    },
  });

  const reader = response.body?.getReader();
  if (!reader) {
    onChunk({ type: "error", error: "Stream not available" });
    return;
  }

  await readSSEStream({
    reader,
    onChunk: (data: unknown) => {
      const usage = getStreamUsage(data);
      if (usage) {
        onChunk({ type: "usage", usage });
      }
      const chunk = getDeepSeekStreamChoice(data);
      const delta = chunk?.delta;
      const finish_reason = chunk?.finish_reason;

      if (!delta) {
        if (finish_reason) {
          finishReason = finish_reason;
        }
        return;
      }

      if (finish_reason) {
        finishReason = finish_reason;
      }

      if (typeof delta.reasoning_content === "string") {
        reasoningBytes += Buffer.byteLength(delta.reasoning_content, "utf8");
        if (reasoningBytes > MAX_STREAM_REASONING_BYTES) {throw new Error("DeepSeek reasoning stream exceeded its size limit");}
        onChunk({ type: "reasoning", reasoning_content: delta.reasoning_content });
      }
      if (typeof delta.content === "string") {
        contentBytes += Buffer.byteLength(delta.content, "utf8");
        if (contentBytes > MAX_STREAM_CONTENT_BYTES) {throw new Error("DeepSeek content stream exceeded its size limit");}
        onChunk({ type: "content", content: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        onChunk({ type: "tool_call", tool_calls: parseStreamToolCalls(delta.tool_calls) });
      }
    },
    onDone: emitDone,
    signal,
  });
}

interface DeepSeekStreamDelta {
  reasoning_content?: unknown;
  content?: unknown;
  tool_calls?: unknown;
}

interface DeepSeekStreamChoice {
  delta?: DeepSeekStreamDelta;
  finish_reason?: string;
}

function getStreamUsage(data: unknown): ProviderUsage | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  return parseProviderUsage((data as { usage?: unknown }).usage);
}

function getDeepSeekStreamChoice(data: unknown): DeepSeekStreamChoice | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }
  const choice = choices[0];
  return choice && typeof choice === "object" ? (choice as DeepSeekStreamChoice) : undefined;
}

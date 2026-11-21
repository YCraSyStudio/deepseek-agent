import { HistoricalFileRecovery } from "./MissingHistoricalFiles";
import { buildApiUrl, deepseekFetch } from "@/infrastructure/deepseek/client/DeepSeekFetch";
import { readSSEStream } from "@/infrastructure/deepseek/streaming/ReadSSEStream";
import { DEFAULT_CONFIG, type AppConfig, type ChatCompletionRequest, type ChatCompletionResponse, type StreamChunk } from "@/contracts";
import { parseChatCompletionResponse, parseStreamToolCalls } from "./ChatResponseValidation";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { isOfficialDeepSeekEndpoint, parseProviderUsage } from "@/shared/usage/Usage";
import { MAX_CHAT_RESPONSE_BYTES, readBoundedJson } from "@/infrastructure/deepseek/client/BoundedResponseJson";
import { resolveDeepSeekApiBaseUrl } from "@/infrastructure/deepseek/client/BetaFeatures";
import { prepareProviderTools } from "./StrictTools";

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
    body.tools = prepareProviderTools(request.tools, config.strictToolCallsEnabled === true);
  }
  if (request.tool_choice) {
    body.tool_choice = request.tool_choice;
  }
  if (config.privacyMinimizeData !== false) {
    body.user_id = undefined;
  } else if (request.user_id) {
    body.user_id = request.user_id;
  } else if (config.userId) {
    body.user_id = config.userId;
  }

  return body;
}

export async function chatCompletion(request: ChatRequest, apiKey: string, baseUrl: string, signal?: AbortSignal, betaFeaturesEnabled = false, historicalFiles?: HistoricalFileRecovery): Promise<ChatResponse> {
  validatePrefixRequest(request, betaFeaturesEnabled);
  request = prepareTransportRequest(request, betaFeaturesEnabled);
  baseUrl = resolveDeepSeekApiBaseUrl(baseUrl, betaFeaturesEnabled);
  const response = await fetchChatResponse({ ...request, stream: false }, apiKey, baseUrl, signal, historicalFiles);
  return parseChatCompletionResponse(await readBoundedJson(response, MAX_CHAT_RESPONSE_BYTES));
}

interface ChatCompletionStreamOptions {
  request: ChatRequest;
  apiKey: string;
  baseUrl: string;
  onChunk: (chunk: ChatStreamChunk) => void;
  signal?: AbortSignal;
  betaFeaturesEnabled?: boolean;
  historicalFiles?: HistoricalFileRecovery;
}

export async function chatCompletionStream(options: ChatCompletionStreamOptions): Promise<void> {
  const { apiKey, onChunk, signal } = options;
  const request = prepareTransportRequest(options.request, options.betaFeaturesEnabled === true);
  validatePrefixRequest(request, options.betaFeaturesEnabled === true);
  const baseUrl = resolveDeepSeekApiBaseUrl(options.baseUrl, options.betaFeaturesEnabled === true);
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

  const response = await fetchChatResponse({ ...request, stream: true,
    ...(isOfficialDeepSeekEndpoint(baseUrl) ? { stream_options: { include_usage: true } } : {}),
  }, apiKey, baseUrl, signal, options.historicalFiles);

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

/** Retry only an HTTP rejection before any stream data or tool execution, at most once. */
async function fetchChatResponse(request: ChatRequest, apiKey: string, baseUrl: string, signal?: AbortSignal, recovery = new HistoricalFileRecovery(request.messages)): Promise<Response> {
  const prepared = recovery.prepare(request);
  const send = (candidate: ChatRequest) => deepseekFetch({ pathOrUrl: buildApiUrl(baseUrl, "chat/completions"), apiKey, baseUrl,
    requestInit: { method: "POST", body: JSON.stringify(candidate), signal } });
  try {return await send(prepared);}
  catch (error) {
    const recovered = !signal?.aborted && recovery.recover(prepared, error);
    if (!recovered) {throw error;}
    return send(recovered);
  }
}

function validatePrefixRequest(request: ChatRequest, betaEnabled: boolean): void {
  for (const [index, message] of request.messages.entries()) {
    if (!message.prefix) {continue;}
    if (!betaEnabled) {throw new Error("DeepSeek beta features are disabled.");}
    if (index !== request.messages.length - 1 || message.role !== "assistant" || typeof message.content !== "string") {
      throw new Error("Chat prefix completion requires a final assistant text message.");
    }
    if (message.reasoning_content && request.thinking?.type !== "enabled") {throw new Error("A reasoning prefix requires thinking mode.");}
  }
}

function prepareTransportRequest(request: ChatRequest, betaEnabled: boolean): ChatRequest {
  const normalized = normalizeThinkingToolCallMessages(request);
  if (betaEnabled) {return normalized;}
  validatePrefixRequest(normalized, false);
  return { ...normalized,
    messages: normalized.messages.map(({ prefix: _prefix, ...message }) => message),
    ...(normalized.tools ? { tools: prepareProviderTools(normalized.tools, false) } : {}),
  };
}

/**
 * Thinking requests with tools require reasoning_content on ALL assistant turns,
 * including final answers and host observations. Preserve provider reasoning verbatim;
 * use an empty string only for legacy/synthetic messages that have none.
 */
function normalizeThinkingToolCallMessages(request: ChatRequest): ChatRequest {
  if (request.thinking?.type !== "enabled") {return request;}
  let changed = false;
  const messages = request.messages.map((message) => {
    if (message.role !== "assistant" || typeof message.reasoning_content === "string") {
      return message;
    }
    changed = true;
    return { ...message, reasoning_content: "" };
  });
  return changed ? { ...request, messages } : request;
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

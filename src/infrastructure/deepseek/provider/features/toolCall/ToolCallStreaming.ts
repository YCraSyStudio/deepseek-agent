import type { ChatMessage, StreamChunk, ToolCall, ToolDefinition } from "@/contracts";
import { chatCompletionStream, type ChatResponse } from "../Chat";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { buildToolCallRequest } from "./ToolCallRequest";
import { assertUniqueToolCallIds } from "../ChatResponseValidation";
import type { ToolCallCycleOptions } from "@/application/chat/toolCall/ToolCallTypes";

interface StreamToolCallRoundOptions {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  model: string;
  apiKey: string;
  baseUrl: string;
  cycleOptions: ToolCallCycleOptions;
  emitStreamEvents?: boolean;
}

const MAX_TOOL_ARGUMENT_BYTES = 2 * 1024 * 1024;

export async function streamToolCallRound(options: StreamToolCallRoundOptions): Promise<ChatResponse> {
  return streamToolCallRoundAttempt(options, false);
}

async function streamToolCallRoundAttempt(options: StreamToolCallRoundOptions, conciseRecovery: boolean): Promise<ChatResponse> {
  const { messages, tools, model, apiKey, baseUrl, cycleOptions, emitStreamEvents = true } = options;
  const effectiveMessages = conciseRecovery ? withConciseRecoveryInstruction(messages) : messages;
  const effectiveCycleOptions = conciseRecovery
    ? { ...cycleOptions, thinkingMode: false, reasoningEffort: undefined }
    : cycleOptions;
  const streamRequest = buildToolCallRequest({
    model,
    messages: effectiveMessages,
    tools,
    stream: true,
    cycleOptions: effectiveCycleOptions,
  });

  let finalContent = "";
  let finalReasoning = "";
  let hasToolCallsInStream = false;
  const streamingToolCalls = new Map<number, ToolCall>();
  let finishReason: string | null = null;
  let usage: ProviderUsage | undefined;
  let stoppedForExcessiveReasoning = false;
  const internalController = new AbortController();
  const combinedSignal = cycleOptions.signal
    ? AbortSignal.any([cycleOptions.signal, internalController.signal])
    : internalController.signal;

  try {
    await chatCompletionStream({
      request: streamRequest,
      apiKey,
      baseUrl,
      onChunk: (chunk) => {
        if (chunk.type === "usage" && chunk.usage) {
          usage = chunk.usage;
        }
        const state = { finalContent, finalReasoning, hasToolCallsInStream, streamingToolCalls, finishReason };
        const nextState = applyStreamChunk({ chunk, state, cycleOptions, emitStreamEvents });
        finalContent = nextState.finalContent;
        finalReasoning = nextState.finalReasoning;
        hasToolCallsInStream = nextState.hasToolCallsInStream;
        finishReason = nextState.finishReason;
        if (chunk.type === "content" || chunk.type === "reasoning") {
          const assessment = cycleOptions.budgetManager?.observeOutput(chunk.reasoning_content, chunk.content);
          if (
            assessment?.status === "output_reasoning_limit" &&
            !conciseRecovery &&
            cycleOptions.budgetManager?.canRecoverConcise()
          ) {
            stoppedForExcessiveReasoning = true;
            internalController.abort();
          }
        }
      },
      signal: combinedSignal,
    });
  } catch (error) {
    if (stoppedForExcessiveReasoning && !cycleOptions.signal?.aborted && cycleOptions.budgetManager) {
      cycleOptions.budgetManager.recordConciseRecovery();
      await cycleOptions.onRecoveryStarted?.();
      return streamToolCallRoundAttempt(options, true);
    }
    throw error;
  } finally {
    cycleOptions.budgetManager?.recordPromptUsage(effectiveMessages, tools, usage);
    cycleOptions.budgetManager?.recordRequestContext(effectiveMessages, tools, usage);
    cycleOptions.onUsage?.(usage);
  }

  const toolCalls = hasToolCallsInStream ? sortedToolCalls(streamingToolCalls) : undefined;
  if (toolCalls) {assertUniqueToolCallIds(toolCalls);}
  const message: ChatMessage = {
    role: "assistant",
    content: finalContent || null,
    reasoning_content: finalReasoning || null,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  };

  return {
    id: "",
    object: "Chat.completion",
    created: Date.now(),
    ...(usage !== undefined ? { usage } : {}),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason as "stop" | "length" | "tool_calls" | "content_filter" | "insufficient_system_resource" | null,
      },
    ],
  };
}

function withConciseRecoveryInstruction(messages: ChatMessage[]): ChatMessage[] {
  const instruction = "The previous attempt approached its output budget while reasoning. Reasoning further is unnecessary. Trust successful results already present, avoid additional verification, and return the required answer or one essential valid tool call concisely.";
  return messages.map((message, index) => index === 0 && message.role === "system"
    ? { ...message, content: `${message.content ?? ""}\n\n<concise_recovery>${instruction}</concise_recovery>` }
    : message);
}

interface StreamState {
  finalContent: string;
  finalReasoning: string;
  hasToolCallsInStream: boolean;
  streamingToolCalls: Map<number, ToolCall>;
  finishReason: string | null;
}

function applyStreamChunk(options: { chunk: StreamChunk; state: StreamState; cycleOptions: ToolCallCycleOptions; emitStreamEvents: boolean }): StreamState {
  const { chunk, state, cycleOptions, emitStreamEvents } = options;

  switch (chunk.type) {
    case "content": {
      const content = chunk.content ?? "";
      if (emitStreamEvents && content) {
        cycleOptions.onStreamChunk?.(content);
      }
      return { ...state, finalContent: state.finalContent + content };
    }
    case "reasoning": {
      const reasoning = chunk.reasoning_content ?? "";
      if (emitStreamEvents && reasoning) {
        cycleOptions.onStreamReasoning?.(reasoning);
      }
      return { ...state, finalReasoning: state.finalReasoning + (chunk.reasoning_content ?? "") };
    }
    case "tool_call":
      mergeStreamingToolCalls(state.streamingToolCalls, chunk.tool_calls);
      return { ...state, hasToolCallsInStream: true };
    case "usage":
      return state;
    case "done":
      return {
        ...state,
        finishReason: chunk.finish_reason ?? state.finishReason,
      };
    case "error":
      throw new Error(chunk.error ?? "Stream error during final response");
  }
}

function mergeStreamingToolCalls(streamingToolCalls: Map<number, ToolCall>, partialToolCalls: ToolCall[] | undefined): void {
  if (!partialToolCalls) {
    return;
  }

  for (const partialTc of partialToolCalls) {
    const idx = partialTc.index ?? 0;
    const existing = streamingToolCalls.get(idx);
    if (!existing) {
      if (Buffer.byteLength(partialTc.function?.arguments ?? "", "utf8") > MAX_TOOL_ARGUMENT_BYTES) {
        throw new Error("DeepSeek tool arguments exceeded their size limit");
      }
      streamingToolCalls.set(idx, {
        id: partialTc.id ?? "",
        type: "function",
        function: {
          name: partialTc.function?.name ?? "",
          arguments: partialTc.function?.arguments ?? "",
        },
        index: idx,
      });
      continue;
    }

    if (partialTc.id) {
      existing.id = partialTc.id;
    }
    if (partialTc.function?.name) {
      existing.function.name = partialTc.function.name;
    }
    if (partialTc.function?.arguments) {
      existing.function.arguments += partialTc.function.arguments;
      if (Buffer.byteLength(existing.function.arguments, "utf8") > MAX_TOOL_ARGUMENT_BYTES) {
        throw new Error("DeepSeek tool arguments exceeded their size limit");
      }
    }
  }
}

function sortedToolCalls(streamingToolCalls: Map<number, ToolCall>): ToolCall[] {
  return Array.from(streamingToolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, toolCall]) => toolCall);
}

import type { ChatCompletionResponse, ChatMessage, ToolCall } from "@/contracts";
import { parseProviderUsage } from "@/shared/usage/Usage";
import { isRecord } from "@/shared/utils/TypeGuards";

const FINISH_REASONS = new Set(["stop", "length", "tool_calls", "content_filter", "insufficient_system_resource", null]);

export function parseChatCompletionResponse(value: unknown): ChatCompletionResponse {
  if (!isRecord(value) || !isString(value.id) || !isString(value.object) || !isFiniteNumber(value.created) || !isString(value.model) || !Array.isArray(value.choices) || value.choices.length === 0) {
    throw new Error("DeepSeek returned an invalid chat completion response");
  }

  const usage = parseProviderUsage(value.usage);
  const choices = value.choices.map((choice) => {
    if (!isRecord(choice) || !Number.isSafeInteger(choice.index) || !isChatMessage(choice.message) || !FINISH_REASONS.has(choice.finish_reason as never)) {
      throw new Error("DeepSeek returned an invalid chat completion choice");
    }
    return {
      index: choice.index as number,
      message: choice.message,
      finish_reason: choice.finish_reason as ChatCompletionResponse["choices"][number]["finish_reason"],
      ...(choice.logprobs !== undefined ? { logprobs: choice.logprobs } : {}),
    };
  });

  return {
    id: value.id,
    object: value.object,
    created: value.created,
    model: value.model,
    choices,
    ...(usage !== undefined ? { usage } : {}),
  };
}

export function parseStreamToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) {
    throw new Error("DeepSeek returned invalid streamed tool calls");
  }
  return value.map((toolCall, position) => {
    if (!isRecord(toolCall) || (toolCall.id !== undefined && !isString(toolCall.id)) || (toolCall.type !== undefined && toolCall.type !== "function") || (toolCall.index !== undefined && !Number.isSafeInteger(toolCall.index))) {
      throw new Error("DeepSeek returned an invalid streamed tool call");
    }
    const fn = toolCall.function;
    if (fn !== undefined && (!isRecord(fn) || (fn.name !== undefined && !isString(fn.name)) || (fn.arguments !== undefined && !isString(fn.arguments)))) {
      throw new Error("DeepSeek returned invalid streamed tool arguments");
    }
    return {
      id: (toolCall.id as string | undefined) ?? "",
      type: "function",
      function: {
        name: (fn as Record<string, unknown> | undefined)?.name as string | undefined ?? "",
        arguments: (fn as Record<string, unknown> | undefined)?.arguments as string | undefined ?? "",
      },
      index: (toolCall.index as number | undefined) ?? position,
    };
  });
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || !["system", "user", "assistant", "tool"].includes(value.role as string)) {
    return false;
  }
  if (value.content !== null && !isString(value.content)) {
    return false;
  }
  if (value.reasoning_content !== undefined && value.reasoning_content !== null && !isString(value.reasoning_content)) {
    return false;
  }
  if (value.tool_calls !== undefined && (
    !Array.isArray(value.tool_calls) ||
    !value.tool_calls.every(isToolCall) ||
    !hasUniqueNonEmptyToolCallIds(value.tool_calls)
  )) {
    return false;
  }
  return (value.tool_call_id === undefined || isString(value.tool_call_id)) && (value.name === undefined || isString(value.name));
}

export function assertUniqueToolCallIds(toolCalls: readonly ToolCall[], previouslySeen: ReadonlySet<string> = new Set()): void {
  const seen = new Set(previouslySeen);
  for (const toolCall of toolCalls) {
    if (!toolCall.id.trim()) {
      throw new Error("DeepSeek returned an empty tool-call ID");
    }
    if (seen.has(toolCall.id)) {
      throw new Error(`DeepSeek returned duplicate tool-call ID "${toolCall.id}"`);
    }
    seen.add(toolCall.id);
  }
}

function isToolCall(value: unknown): value is ToolCall {
  return (
    isRecord(value) &&
    isString(value.id) &&
    value.type === "function" &&
    isRecord(value.function) &&
    isString(value.function.name) &&
    isString(value.function.arguments) &&
    (value.index === undefined || Number.isSafeInteger(value.index))
  );
}

function hasUniqueNonEmptyToolCallIds(toolCalls: ToolCall[]): boolean {
  try {
    assertUniqueToolCallIds(toolCalls);
    return true;
  } catch {
    return false;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

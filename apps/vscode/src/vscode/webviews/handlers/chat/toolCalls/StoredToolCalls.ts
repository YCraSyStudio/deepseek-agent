import type { StoredToolCall } from "@/contracts";

export function upsertStoredToolCall(toolCalls: StoredToolCall[], value: StoredToolCall): void {
  const index = toolCalls.findIndex((toolCall) => toolCall.toolCallId === value.toolCallId);
  if (index >= 0) {
    toolCalls[index] = { ...toolCalls[index], ...value };
  } else {
    toolCalls.push(value);
  }
}

export function isStoredToolStatus(value: unknown): value is StoredToolCall["status"] {
  return value === "pending" ||
    value === "awaiting_confirmation" ||
    value === "running" ||
    value === "completed" ||
    value === "rejected" ||
    value === "cancelled" ||
    value === "error";
}

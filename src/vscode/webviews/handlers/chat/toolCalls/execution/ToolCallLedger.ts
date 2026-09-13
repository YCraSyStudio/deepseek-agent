import type { ToolCall } from "@/contracts";
import { redactToolOutput } from "@/shared/security/ToolOutputRedaction";
import type { StoredExecution, ToolExecutionContext } from "../Types";

export function recordInitialToolCall(toolCall: ToolCall, ctx: ToolExecutionContext): void {
  const requiresConfirmation = !ctx.autoApproveMode && !ctx.fullAccessMode;
  ctx.executedToolCalls.set(toolCall.id, {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    arguments: redactToolOutput(toolCall.function.arguments),
    round: ctx.getCurrentRound(),
    requiresConfirmation,
    status: requiresConfirmation ? "awaiting_confirmation" : "running",
  });
}

export function updateStoredToolCall(
  ctx: ToolExecutionContext,
  toolCallId: string,
  patch: Partial<StoredExecution>,
): void {
  const existing = ctx.executedToolCalls.get(toolCallId);
  if (existing) {
    Object.assign(existing, patch);
  }
}

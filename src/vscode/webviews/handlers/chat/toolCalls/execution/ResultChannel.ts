import type { ToolCall } from "@/contracts";
import { createExecutionResult } from "@/application/tools/ToolExecutor";
import type { ExecutionResult } from "@/application/tools/Types";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { redactToolOutput } from "@/shared/security/ToolOutputRedaction";
import type { StoredExecution, ToolExecutionContext } from "../Types";
import { updateStoredToolCall } from "./ToolCallLedger";

export function createRejectedResult(toolCall: ToolCall, result: string): ExecutionResult & { rejected: true; status: "rejected" } {
  return { ...createExecutionResult(toolCall, { kind: "rejected", content: result }), rejected: true, status: "rejected" };
}

export function createErrorResult(toolCall: ToolCall, result: string): ExecutionResult & { status: "error" } {
  return { ...createExecutionResult(toolCall, { kind: "error", content: result }), status: "error" };
}

export function postToolCallResult(
  ctx: ToolExecutionContext,
  result: ExecutionResult & { rejected?: boolean },
): void {
  const redacted = { ...result, outcome: { ...result.outcome, content: redactToolOutput(result.outcome.content) } };
  const isError = redacted.outcome.kind === "error";
  if (!isError && (redacted.toolName === "search_web" || redacted.toolName === "read_web")) {
    ctx.markWebTainted?.();
  }
  const status: StoredExecution["status"] = redacted.status === "confirmation_required"
    ? "awaiting_confirmation"
    : redacted.status;
  void ctx.eventSink.publish({
    type: "toolCallResult",
    toolCallId: redacted.toolCallId,
    toolName: redacted.toolName,
    result: redacted.outcome.content,
    isError,
    rejected: redacted.rejected,
    status,
  });
  updateStoredToolCall(ctx, redacted.toolCallId, {
    result: redacted.outcome.content,
    isError,
    rejected: redacted.rejected,
    requiresConfirmation: false,
    status,
  });
}

export function clearFileDiffPreview(): void {
  try {
    getToolWorkspaceHost().clearFileDiffPreview?.();
  } catch {
  }
}

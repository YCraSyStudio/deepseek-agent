import type { ToolCall } from "@/contracts";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import { redactToolOutput } from "@/shared/security/ToolOutputRedaction";
import type { HandleExecutionResultOptions, ToolExecutionContext } from "../Types";
import { executeForcedAfterTrust } from "./DangerPolicy";
import { handlerContext } from "./PipelineContext";
import { clearFileDiffPreview, createErrorResult, createRejectedResult, postToolCallResult } from "./ResultChannel";
import { updateStoredToolCall } from "./ToolCallLedger";

const DANGER_CANCELLED = "Tool call cancelled by user (dangerous operation)";
const USER_REJECTED = "Tool call rejected by user";
const CYCLE_UNAVAILABLE = "Tool call cycle not available";

export async function handleExecutionResult(
  options: HandleExecutionResultOptions,
  dangerOverride?: ConfirmationRequiredResult,
): Promise<string> {
  const { toolCall, result, ctx, announceStarted, round } = options;
  const dangerInfo = dangerOverride ?? ToolExecutor.isConfirmationRequired(result.outcome.content);
  const isError = result.outcome.kind === "error";
  updateStoredToolCall(ctx, toolCall.id, {
    result: redactToolOutput(result.outcome.content),
    isError,
    dangerLevel: dangerInfo?.dangerLevel,
  });

  if (!dangerInfo) {
    postToolCallResult(ctx, result);
    return result.outcome.content;
  }

  updateStoredToolCall(ctx, toolCall.id, { status: "awaiting_confirmation" });
  const decision = await ctx.requestDangerConfirmation(toolCall, dangerInfo, { announceStarted, round });
  if (!decision.confirmed) {
    clearFileDiffPreview();
    postToolCallResult(ctx, createRejectedResult(toolCall, DANGER_CANCELLED));
    return DANGER_CANCELLED;
  }

  updateStoredToolCall(ctx, toolCall.id, { status: "running" });
  return executeForcedAfterTrust(toolCall, ctx, dangerInfo);
}

export async function executeManualToolCall(toolCall: ToolCall, ctx: ToolExecutionContext): Promise<string> {
  const individualPromise = ctx.getPendingCycle()?.individualPromises.get(toolCall.id);
  if (!individualPromise) {
    const result = createErrorResult(toolCall, CYCLE_UNAVAILABLE);
    postToolCallResult(ctx, result);
    return CYCLE_UNAVAILABLE;
  }

  const action = await individualPromise;
  if (action === "reject") {
    postToolCallResult(ctx, createRejectedResult(toolCall, USER_REJECTED));
    return USER_REJECTED;
  }

  const result = await ctx.toolExecutor.execute(toolCall, handlerContext(ctx));
  return handleExecutionResult({
    toolCall,
    result,
    ctx,
    round: ctx.getCurrentRound(),
  });
}

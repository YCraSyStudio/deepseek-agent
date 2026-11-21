import type { ToolCall } from "@/contracts";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import { positiveDecisionCache } from "@/infrastructure/tools/safety/DecisionCache";
import type { ToolExecutionContext } from "../Types";
import { handlerContext } from "./PipelineContext";
import { createRejectedResult, postToolCallResult } from "./ResultChannel";
import { updateStoredToolCall } from "./ToolCallLedger";

const SECURITY_REVISION_CODE = "security_review_revise";

export async function reviewDangerousCommandFailClosed(
  toolCall: ToolCall,
  confirmation: ConfirmationRequiredResult,
  ctx: ToolExecutionContext,
): ReturnType<ToolExecutionContext["reviewDangerousCommand"]> {
  try {
    return await ctx.reviewDangerousCommand(toolCall, confirmation);
  } catch {
    return {
      decision: "manual_confirmation",
      risk: "critical",
      confidence: "very_low",
      reason: "DeepSeek safety review failed, so manual confirmation is required.",
    };
  }
}

export function rememberPositiveDecision(decisionKey: string | undefined): void {
  if (decisionKey) {
    positiveDecisionCache.remember(decisionKey);
  }
}

export function rejectCommandForRevision(toolCall: ToolCall, guidance: string, ctx: ToolExecutionContext): string {
  const modelResult = JSON.stringify({
    code: SECURITY_REVISION_CODE,
    constraint: guidance,
  });
  const uiResult = [
    "Security reviewer rejected this command. Do not repeat it or bypass the safety controls.",
    "Re-plan the operation and continue with a safer tool or a more narrowly scoped command.",
    `Reviewer guidance: ${guidance}`,
  ].join(" ");
  postToolCallResult(ctx, createRejectedResult(toolCall, uiResult));
  return modelResult;
}

export async function executeForcedAfterTrust(
  toolCall: ToolCall,
  ctx: ToolExecutionContext,
  confirmation?: ConfirmationRequiredResult,
): Promise<string> {
  const forcedToolCall = confirmation?.beforeHash ? withExpectedBeforeHash(toolCall, confirmation.beforeHash) : toolCall;
  const forcedResult = await ctx.toolExecutor.executeForced(forcedToolCall, handlerContext(ctx));
  postToolCallResult(ctx, forcedResult);
  updateStoredToolCall(ctx, toolCall.id, { dangerConfirmed: true });
  return forcedResult.outcome.content;
}

function withExpectedBeforeHash(toolCall: ToolCall, beforeHash: string): ToolCall {
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    return { ...toolCall, function: { ...toolCall.function, arguments: JSON.stringify({ ...args, expectedBeforeHash: beforeHash }) } };
  } catch { return toolCall; }
}

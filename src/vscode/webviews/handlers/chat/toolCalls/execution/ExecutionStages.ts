import type { ToolCall } from "@/contracts";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { ToolExecutionPipeline } from "@/application/tools/ToolExecutionPipeline";
import type { ConfirmationRequiredResult, ExecutionResult } from "@/application/tools/Types";
import { isAutomaticConfidence } from "@/infrastructure/deepseek/security/commandReview";
import { positiveDecisionCache } from "@/infrastructure/tools/safety/DecisionCache";
import { currentWorkspaceId, evaluateDeterministicSafety } from "../DeterministicSafety";
import type { ToolExecutionContext } from "../Types";
import { handleExecutionResult, executeManualToolCall } from "./ConfirmationFlow";
import {
  executeForcedAfterTrust,
  rejectCommandForRevision,
  rememberPositiveDecision,
  reviewDangerousCommandFailClosed,
} from "./DangerPolicy";
import { addProvenFileScope, handlerContext, isAutomaticExecution, requiresWorkspaceMutationPolicy } from "./PipelineContext";
import { createRejectedResult, postToolCallResult } from "./ResultChannel";

const UNTRUSTED_WORKSPACE = "Tool call rejected because the workspace is not trusted";

export interface ToolPipelineContext {
  toolCall: ToolCall;
  ctx: ToolExecutionContext;
  resultText?: string;
  executionResult?: ExecutionResult;
  confirmation?: ConfirmationRequiredResult;
  dangerOverride?: ConfirmationRequiredResult;
  decisionKey?: string;
}

export function createToolExecutionPipeline(): ToolExecutionPipeline<ToolPipelineContext, string> {
  return new ToolExecutionPipeline([
    {
      name: "argument_validation",
      async handle(context) {
        return { kind: "continue", context };
      },
    },
    {
      name: "workspace_trust",
      async handle(context) {
        if (!context.ctx.isWorkspaceTrusted() && requiresWorkspaceMutationPolicy(context.ctx, context.toolCall)) {
          postToolCallResult(context.ctx, createRejectedResult(context.toolCall, UNTRUSTED_WORKSPACE));
          context.resultText = UNTRUSTED_WORKSPACE;
        }
        return { kind: "continue", context };
      },
    },
    {
      name: "prepare_remote_review",
      async handle(context) {
        if (context.resultText) {return { kind: "continue", context };}
        if (!isAutomaticExecution(context.ctx)) {return { kind: "continue", context };}
        if (!requiresWorkspaceMutationPolicy(context.ctx, context.toolCall)) {
          const result = await context.ctx.toolExecutor.executeForced(context.toolCall, handlerContext(context.ctx));
          postToolCallResult(context.ctx, result);
          context.resultText = result.outcome.content;
          return { kind: "continue", context };
        }
        context.executionResult = await context.ctx.toolExecutor.execute(context.toolCall, handlerContext(context.ctx));
        const confirmation = ToolExecutor.isConfirmationRequired(context.executionResult.outcome.content) ?? undefined;
        context.confirmation = confirmation ? await addProvenFileScope(context.toolCall, confirmation) : undefined;
        if (!context.confirmation) {
          context.resultText = await handleExecutionResult({
            toolCall: context.toolCall,
            result: context.executionResult,
            ctx: context.ctx,
            announceStarted: true,
            round: context.ctx.getCurrentRound(),
          });
        }
        return { kind: "continue", context };
      },
    },
    {
      name: "deterministic_safety",
      async handle(context) {
        const confirmation = context.confirmation;
        if (context.resultText || !context.executionResult || !confirmation) {return { kind: "continue", context };}
        if (!isAutomaticExecution(context.ctx)) {return { kind: "continue", context };}
        const evaluation = await evaluateDeterministicSafety({
          toolCall: context.toolCall,
          confirmation,
          effect: context.ctx.toolExecutor.getMetadata(context.toolCall.function.name)?.effect,
          scope: {
            conversationId: context.ctx.conversationId,
            workspaceId: currentWorkspaceId(),
            permissionFingerprint: context.ctx.permissionFingerprint,
          },
        });
        context.decisionKey = evaluation.key;
        if (evaluation.verdict.kind === "approve") {
          context.resultText = await executeForcedAfterTrust(context.toolCall, context.ctx, confirmation);
        }
        return { kind: "continue", context };
      },
    },
    {
      name: "remote_review",
      async handle(context) {
        const confirmation = context.confirmation;
        if (context.resultText || !context.executionResult || !confirmation) {return { kind: "continue", context };}
        if (context.decisionKey && positiveDecisionCache.has(context.decisionKey)) {
          context.resultText = await executeForcedAfterTrust(context.toolCall, context.ctx, confirmation);
          return { kind: "continue", context };
        }
        const review = await reviewDangerousCommandFailClosed(context.toolCall, confirmation, context.ctx);
        const risk = review.risk;
        const canRunAutomatically = context.ctx.fullAccessMode
          ? risk !== "critical"
          : risk === "routine";
        if (review.decision === "approve" && isAutomaticConfidence(review.confidence) && canRunAutomatically) {
          rememberPositiveDecision(context.decisionKey);
          context.resultText = await executeForcedAfterTrust(context.toolCall, context.ctx, confirmation);
          return { kind: "continue", context };
        }
        if (review.decision === "revise" && isAutomaticConfidence(review.confidence)) {
          context.resultText = rejectCommandForRevision(context.toolCall, review.reason, context.ctx);
          return { kind: "continue", context };
        }
        context.dangerOverride = {
          ...confirmation,
          dangerLevel: risk === "critical" ? "destructive" : risk === "elevated" ? "dangerous" : "caution",
          warningMessage: `${confirmation.warningMessage} DeepSeek classified this action as ${risk}: ${review.reason}`,
        };
        return { kind: "continue", context };
      },
    },
    {
      name: "user_confirmation",
      async handle(context) {
        if (context.resultText) {return { kind: "continue", context };}
        if (context.executionResult && context.confirmation) {
          context.resultText = await handleExecutionResult({
            toolCall: context.toolCall,
            result: context.executionResult,
            ctx: context.ctx,
            announceStarted: true,
            round: context.ctx.getCurrentRound(),
          }, context.dangerOverride);
        } else if (!isAutomaticExecution(context.ctx)) {
          context.resultText = await executeManualToolCall(context.toolCall, context.ctx);
        }
        return { kind: "continue", context };
      },
    },
    {
      name: "execution",
      async handle(context) {
        if (context.resultText) {return { kind: "continue", context };}
        const result = await context.ctx.toolExecutor.execute(context.toolCall, handlerContext(context.ctx));
        context.resultText = await handleExecutionResult({
          toolCall: context.toolCall,
          result,
          ctx: context.ctx,
          announceStarted: true,
          round: context.ctx.getCurrentRound(),
        });
        return { kind: "continue", context };
      },
    },
    {
      name: "record_and_publish",
      async handle(context) {
        return context.resultText
          ? { kind: "resolved", result: context.resultText }
          : { kind: "resolved", result: "Tool execution produced no result" };
      },
    },
  ]);
}

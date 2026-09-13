import type { ToolCall } from "@/contracts";
import { redactToolOutput } from "@/shared/security/ToolOutputRedaction";
import type { ToolExecutionContext } from "./Types";
import { createToolExecutionPipeline } from "./execution/ExecutionStages";
import { createErrorResult, postToolCallResult } from "./execution/ResultChannel";
import { recordInitialToolCall } from "./execution/ToolCallLedger";

export async function executeToolCall(toolCall: ToolCall, ctx: ToolExecutionContext): Promise<string> {
  recordInitialToolCall(toolCall, ctx);
  const decision = await createToolExecutionPipeline().execute({
    toolCall,
    ctx,
  });
  if (decision.kind === "resolved") {return redactToolOutput(decision.result);}
  throw new Error("Tool execution pipeline completed without a result");
}

export function recordSyntheticToolError(toolCall: ToolCall, ctx: ToolExecutionContext, result: string): void {
  recordInitialToolCall(toolCall, ctx);
  postToolCallResult(ctx, createErrorResult(toolCall, result));
}

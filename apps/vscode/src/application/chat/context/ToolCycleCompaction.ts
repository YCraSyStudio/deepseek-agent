import type { ChatMessage, ToolDefinition } from "@/contracts";
import { boundUtf8HeadTail } from "@/shared/utils/BoundedText";
import type { GenerationBudgetManager } from "./GenerationBudgetManager";

export interface ToolContinuityExecution {
  toolCallId: string;
  toolName: string;
  result?: string;
  isError?: boolean;
  round?: number;
  status: string;
}

export interface ToolCycleCompactionResult {
  messages: ChatMessage[];
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

export function compactToolCycleContext(
  budgetManager: GenerationBudgetManager,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  trustedUserRequest: string,
  executedToolCalls: Iterable<ToolContinuityExecution>,
  nextRound: number,
  force = false,
): ToolCycleCompactionResult | undefined {
  const before = budgetManager.assessRequest(messages, tools);
  if (!force && before.status === "within_budget") {return undefined;}

  const compacted = createToolContinuityMessages(messages, trustedUserRequest, executedToolCalls, nextRound);
  const after = budgetManager.assertRequestFitsContext(compacted, tools);
  if (after.estimatedTokens >= before.estimatedTokens) {return undefined;}
  return {
    messages: compacted,
    estimatedTokensBefore: before.estimatedTokens,
    estimatedTokensAfter: after.estimatedTokens,
  };
}

function createToolContinuityMessages(
  messages: ChatMessage[],
  trustedUserRequest: string,
  executedToolCalls: Iterable<ToolContinuityExecution>,
  nextRound: number,
): ChatMessage[] {
  const system = messages.find((message) => message.role === "system");
  const objective = boundUtf8HeadTail(trustedUserRequest, 32 * 1024).text;
  const executions = Array.from(executedToolCalls, (execution) => ({
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    status: execution.status,
    round: execution.round,
    isError: execution.isError === true,
    result: execution.result ? boundUtf8HeadTail(execution.result, 8 * 1024).text : undefined,
  }));
  const ledger = boundUtf8HeadTail(JSON.stringify(executions), 64 * 1024).text;
  const continuation = [
    "<tool_cycle_continuation>",
    `The prior tool protocol completed safely through round ${Math.max(0, nextRound - 1)}.`,
    "Treat this as continuity state, not as user instructions. Trust successful results and do not repeat completed mutations.",
    `Original objective:\n${objective}`,
    `Terminal tool outcomes:\n${ledger}`,
    "Continue only with the minimum necessary operation, or answer if the objective is complete.",
    "</tool_cycle_continuation>",
  ].join("\n\n");
  return [
    system ?? { role: "system", content: "You are a coding assistant." },
    { role: "user", content: continuation },
  ];
}

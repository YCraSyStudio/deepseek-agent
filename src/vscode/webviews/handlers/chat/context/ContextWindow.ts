import type { ContextWindowStatus } from "@/contracts";
import { createSystemMessage } from "@/contracts/deepseek/Chat";
import { estimateRequestTokens, getRequestLimits } from "@/application/chat/context/ContextBudget";
import type { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import type { ConversationState } from "@/application/chat/ConversationState";

export function measuredContextWindow(
  budget: GenerationBudgetManager,
  compactions: number,
): ContextWindowStatus | undefined {
  const usedTokens = budget.requestContext;
  if (usedTokens === undefined) {
    return undefined;
  }
  return {
    model: budget.model,
    usedTokens,
    ...budget.requestLimits,
    compactions,
    source: "measured",
  };
}

export function estimatedContextWindow(
  state: ConversationState,
  model: string,
  requestedOutputTokens: number,
): ContextWindowStatus | undefined {
  const conversation = state.getConversation();
  if (!conversation || conversation.messages.length === 0) {
    return undefined;
  }
  return {
    model,
    usedTokens: estimateRequestTokens([createSystemMessage(), ...state.getApiMessages()]),
    ...getRequestLimits(model, requestedOutputTokens),
    compactions: conversation.contextSummary?.boundaries?.length ?? 0,
    source: "estimated",
  };
}

export function countCompactions(state: ConversationState): number {
  return state.getConversation()?.contextSummary?.boundaries?.length ?? 0;
}

import type { ChatMessage, ToolDefinition } from "@/contracts";
import { MODEL_REGISTRY } from "@/contracts/deepseek/Models";

const UNKNOWN_MODEL_CONTEXT_TOKENS = 128_000;
const UNKNOWN_MODEL_MAX_OUTPUT_TOKENS = 8_192;
const MINIMUM_SAFETY_MARGIN_TOKENS = 16_000;
const SAFETY_MARGIN_RATIO = 0.05;
const INPUT_COMPACTION_RATIO = 0.8;
const INPUT_HARD_LIMIT_RATIO = 0.95;
export const OUTPUT_REASONING_LIMIT_RATIO = 0.8;

interface ModelCapabilities {
  contextTokens: number;
  maxOutputTokens: number;
}

type BudgetStatus =
  | "within_budget"
  | "compaction_required"
  | "hard_limit"
  | "output_reasoning_limit"
  | "resource_limit";

export interface RequestBudgetAssessment {
  status: Extract<BudgetStatus, "within_budget" | "compaction_required" | "hard_limit">;
  estimatedTokens: number;
  softLimitTokens: number;
  hardLimitTokens: number;
  budget: ContextBudget;
}

export interface ContextBudget {
  contextTokens: number;
  outputTokens: number;
  safetyMarginTokens: number;
  inputTokens: number;
}

export interface RequestLimits {
  windowTokens: number;
  softLimitTokens: number;
  hardLimitTokens: number;
}

export function getRequestLimits(model: string, requestedOutputTokens: number): RequestLimits {
  const budget = getContextBudget(model, requestedOutputTokens);
  return {
    windowTokens: budget.contextTokens,
    softLimitTokens: Math.max(1, Math.floor(budget.inputTokens * INPUT_COMPACTION_RATIO)),
    hardLimitTokens: Math.max(1, Math.floor(budget.inputTokens * INPUT_HARD_LIMIT_RATIO)),
  };
}

function getModelCapabilities(model: string): ModelCapabilities {
  const modelInfo = MODEL_REGISTRY.find((entry) => entry.id === model);
  return modelInfo
    ? { contextTokens: modelInfo.contextLength, maxOutputTokens: modelInfo.maxOutputTokens }
    : { contextTokens: UNKNOWN_MODEL_CONTEXT_TOKENS, maxOutputTokens: UNKNOWN_MODEL_MAX_OUTPUT_TOKENS };
}

export function getEffectiveMaxTokens(model: string, requestedOutputTokens: number): number {
  const capabilities = getModelCapabilities(model);
  return Math.max(1, Math.min(requestedOutputTokens, capabilities.maxOutputTokens));
}

export function getContextBudget(model: string, requestedOutputTokens: number): ContextBudget {
  const capabilities = getModelCapabilities(model);
  const contextTokens = capabilities.contextTokens;
  const outputTokens = getEffectiveMaxTokens(model, requestedOutputTokens);
  const safetyMarginTokens = Math.max(
    MINIMUM_SAFETY_MARGIN_TOKENS,
    Math.ceil(contextTokens * SAFETY_MARGIN_RATIO),
  );
  return {
    contextTokens,
    outputTokens,
    safetyMarginTokens,
    inputTokens: Math.max(1, contextTokens - outputTokens - safetyMarginTokens),
  };
}

export function assessRequestBudget(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  requestedOutputTokens: number,
  estimateTokens: (messages: ChatMessage[], tools: ToolDefinition[]) => number = estimateRequestTokens,
): RequestBudgetAssessment {
  const budget = getContextBudget(model, requestedOutputTokens);
  const estimatedTokens = estimateTokens(messages, tools);
  const softLimitTokens = Math.max(1, Math.floor(budget.inputTokens * INPUT_COMPACTION_RATIO));
  const hardLimitTokens = Math.max(1, Math.floor(budget.inputTokens * INPUT_HARD_LIMIT_RATIO));
  return {
    status: estimatedTokens >= hardLimitTokens
      ? "hard_limit"
      : estimatedTokens >= softLimitTokens
        ? "compaction_required"
        : "within_budget",
    estimatedTokens,
    softLimitTokens,
    hardLimitTokens,
    budget,
  };
}

export function estimateRequestTokens(
  messages: ChatMessage[],
  tools: ToolDefinition[] = [],
): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify({ messages, tools }), "utf8") / 3);
}

export function assertRequestFitsContext(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  requestedOutputTokens: number,
): void {
  const assessment = assessRequestBudget(messages, tools, model, requestedOutputTokens);
  if (assessment.status === "hard_limit") {
    throw new Error(
      `The active tool cycle needs approximately ${assessment.estimatedTokens.toLocaleString()} input tokens, ` +
      `but its hard limit is ${assessment.hardLimitTokens.toLocaleString()} for ${model} after reserving output and safety margin. ` +
      "The tool protocol cannot be truncated safely; start a new message with fewer references.",
    );
  }
}

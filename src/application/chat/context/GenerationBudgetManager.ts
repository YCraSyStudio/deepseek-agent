import type { ChatMessage, ToolDefinition } from "@/contracts";
import type { ProviderUsage } from "@/shared/usage/Usage";
import {
  OUTPUT_REASONING_LIMIT_RATIO,
  assessRequestBudget,
  estimateRequestTokens,
  getEffectiveMaxTokens,
  getRequestLimits,
  type RequestBudgetAssessment,
  type RequestLimits,
} from "./ContextBudget";

const MAX_AUTOMATIC_COMPACTIONS = 3;
const MAX_CONCISE_RECOVERIES = 1;
const MIN_SIGNIFICANT_CONTENT_TOKENS = 512;

export interface OutputBudgetAssessment {
  status: "within_budget" | "output_reasoning_limit" | "hard_limit";
  estimatedTokens: number;
  reasoningTokens: number;
  contentTokens: number;
  maxTokens: number;
}

export class GenerationBudgetManager {
  private estimateScale = 1;
  private automaticCompactions = 0;
  private conciseRecoveries = 0;
  private reasoningBytes = 0;
  private contentBytes = 0;
  private requestContextTokens?: number;

  constructor(
    readonly model: string,
    readonly requestedMaxTokens: number,
  ) {}

  get effectiveMaxTokens(): number {
    return getEffectiveMaxTokens(this.model, this.requestedMaxTokens);
  }

  assessRequest(messages: ChatMessage[], tools: ToolDefinition[]): RequestBudgetAssessment {
    return assessRequestBudget(
      messages,
      tools,
      this.model,
      this.effectiveMaxTokens,
      (requestMessages, requestTools) => Math.ceil(estimateRequestTokens(requestMessages, requestTools) * this.estimateScale),
    );
  }

  assertRequestFitsContext(messages: ChatMessage[], tools: ToolDefinition[]): RequestBudgetAssessment {
    const assessment = this.assessRequest(messages, tools);
    if (assessment.status === "hard_limit") {
      throw new Error(
        `The active request needs approximately ${assessment.estimatedTokens.toLocaleString()} input tokens, ` +
        `but its calibrated hard limit is ${assessment.hardLimitTokens.toLocaleString()} for ${this.model} after reserving output and safety margin. ` +
        "Reduce the current request or continue in a new message.",
      );
    }
    return assessment;
  }

  recordPromptUsage(messages: ChatMessage[], tools: ToolDefinition[], usage?: ProviderUsage): void {
    if (!usage || usage.prompt_tokens <= 0) {return;}
    const estimated = estimateRequestTokens(messages, tools);
    if (estimated <= 0) {return;}
    const observedScale = usage.prompt_tokens / estimated;
    this.estimateScale = Math.min(4, Math.max(this.estimateScale, observedScale));
  }

  recordRequestContext(messages: ChatMessage[], tools: ToolDefinition[], usage?: ProviderUsage): void {
    if (usage && usage.prompt_tokens > 0) {
      this.requestContextTokens = usage.prompt_tokens + (usage.completion_tokens ?? 0);
      return;
    }
    const estimated = Math.ceil(estimateRequestTokens(messages, tools) * this.estimateScale);
    if (estimated > 0) {
      this.requestContextTokens = estimated;
    }
  }

  get requestContext(): number | undefined {
    return this.requestContextTokens;
  }

  get requestLimits(): RequestLimits {
    return getRequestLimits(this.model, this.requestedMaxTokens);
  }
  canCompactAutomatically(): boolean {
    return this.automaticCompactions < MAX_AUTOMATIC_COMPACTIONS;
  }

  recordAutomaticCompaction(): void {
    this.automaticCompactions += 1;
  }

  canRecoverConcise(): boolean {
    return this.conciseRecoveries < MAX_CONCISE_RECOVERIES;
  }

  recordConciseRecovery(): void {
    this.conciseRecoveries += 1;
    this.resetOutput();
  }

  observeOutput(reasoning: string | undefined, content: string | undefined): OutputBudgetAssessment {
    this.reasoningBytes += Buffer.byteLength(reasoning ?? "", "utf8");
    this.contentBytes += Buffer.byteLength(content ?? "", "utf8");
    const reasoningTokens = Math.ceil(this.reasoningBytes / 3);
    const contentTokens = Math.ceil(this.contentBytes / 3);
    const estimatedTokens = reasoningTokens + contentTokens;
    const reasoningRatio = estimatedTokens === 0 ? 0 : reasoningTokens / estimatedTokens;
    const reasoningLimit = Math.floor(this.effectiveMaxTokens * OUTPUT_REASONING_LIMIT_RATIO);
    return {
      status: estimatedTokens >= this.effectiveMaxTokens
        ? "hard_limit"
        : estimatedTokens >= reasoningLimit && reasoningRatio >= 0.75 && contentTokens < MIN_SIGNIFICANT_CONTENT_TOKENS
          ? "output_reasoning_limit"
          : "within_budget",
      estimatedTokens,
      reasoningTokens,
      contentTokens,
      maxTokens: this.effectiveMaxTokens,
    };
  }

  resetOutput(): void {
    this.reasoningBytes = 0;
    this.contentBytes = 0;
  }

}

export const USAGE_SCHEMA_VERSION = 1;
export const PRICE_CATALOG_VERSION = 2;
export const READABLE_PRICE_CATALOG_VERSIONS: readonly number[] = [1, PRICE_CATALOG_VERSION];

export interface ProviderUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export type UsagePhase =
  | "primary"
  | "tool_round"
  | "completion_review"
  | "progress_review"
  | "security_review"
  | "context_summary"
  | "file_compaction"
  | "vision_analysis";

export const USAGE_PHASES: readonly UsagePhase[] = [
  "primary",
  "tool_round",
  "completion_review",
  "progress_review",
  "security_review",
  "context_summary",
  "file_compaction",
  "vision_analysis",
];

export interface PhaseUsage {
  requests: number;
  reported: number;
  reasoningReported: number;
  cacheHitReported: number;
  cacheMissReported: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  totalTokens?: number;
}

export interface UsageAggregate extends PhaseUsage {
  schemaVersion: typeof USAGE_SCHEMA_VERSION;
  officialEndpoint: boolean;
  model?: string;
  priceCatalogVersion?: number;
  pricedAt?: string;
  currency?: "USD";
  costUsd?: number;
  count: number;
  byPhase: Partial<Record<UsagePhase, PhaseUsage>>;
  /** Flat model-specific aggregates for generations using more than one model. */
  byModel?: UsageAggregate[];
  saturated?: true;
}

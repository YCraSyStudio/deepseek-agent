import {
  READABLE_PRICE_CATALOG_VERSIONS,
  USAGE_PHASES,
  USAGE_SCHEMA_VERSION,
  type PhaseUsage,
  type ProviderUsage,
  type UsageAggregate,
  type UsagePhase,
} from "./UsageModels";
import { isRecord } from "@/shared/utils/TypeGuards";

export function parseProviderUsage(value: unknown): ProviderUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isNonNegativeCount(value.prompt_tokens) ||
    !isNonNegativeCount(value.completion_tokens) ||
    !isNonNegativeCount(value.total_tokens)
  ) {
    return undefined;
  }

  const usage: ProviderUsage = {
    prompt_tokens: value.prompt_tokens,
    completion_tokens: value.completion_tokens,
    total_tokens: value.total_tokens,
  };
  copyOptionalCount(value, usage, "prompt_cache_hit_tokens");
  copyOptionalCount(value, usage, "prompt_cache_miss_tokens");

  const details = isRecord(value.completion_tokens_details) ? value.completion_tokens_details : undefined;
  if (details && isNonNegativeCount(details.reasoning_tokens)) {
    usage.reasoning_tokens = details.reasoning_tokens;
  }
  return usage;
}

export function isProviderUsage(value: unknown): value is ProviderUsage {
  return parseProviderUsage(value) !== undefined;
}

export function normalizeUsageAggregate(value: unknown): UsageAggregate | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== USAGE_SCHEMA_VERSION ||
    typeof value.officialEndpoint !== "boolean" ||
    !isNonNegativeCount(value.count) ||
    !isRecord(value.byPhase)
  ) {
    return undefined;
  }
  const totals = normalizePhaseUsage(value);
  if (!totals || totals.requests !== value.count) {
    return undefined;
  }
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.length > 256)) {
    return undefined;
  }
  if (
    value.priceCatalogVersion !== undefined &&
    (typeof value.priceCatalogVersion !== "number" ||
      !READABLE_PRICE_CATALOG_VERSIONS.includes(value.priceCatalogVersion))
  ) {
    return undefined;
  }
  const priceCatalogVersion = value.priceCatalogVersion as number | undefined;
  if (value.pricedAt !== undefined && !isUtcInstant(value.pricedAt)) {
    return undefined;
  }
  if (value.currency !== undefined && value.currency !== "USD") {
    return undefined;
  }
  if (!isOptionalNonNegativeNumber(value.costUsd)) {
    return undefined;
  }

  const byPhase: UsageAggregate["byPhase"] = {};
  for (const [phase, phaseValue] of Object.entries(value.byPhase)) {
    if (!isUsagePhase(phase)) {
      return undefined;
    }
    const parsed = normalizePhaseUsage(phaseValue);
    if (!parsed || parsed.requests === 0) {
      return undefined;
    }
    byPhase[phase] = parsed;
  }
  if (!phaseTotalsMatch(totals, byPhase)) {
    return undefined;
  }

  const normalized: UsageAggregate = {
    schemaVersion: USAGE_SCHEMA_VERSION,
    officialEndpoint: value.officialEndpoint,
    ...(value.model !== undefined ? { model: value.model } : {}),
    ...(priceCatalogVersion !== undefined ? { priceCatalogVersion } : {}),
    ...(value.pricedAt !== undefined ? { pricedAt: value.pricedAt } : {}),
    ...(value.currency !== undefined ? { currency: "USD" } : {}),
    ...(value.costUsd !== undefined ? { costUsd: value.costUsd } : {}),
    count: value.count,
    ...totals,
    byPhase,
    ...(value.saturated === true ? { saturated: true } : {}),
  };
  if ((normalized.costUsd === undefined) !== (normalized.currency === undefined)) {
    return undefined;
  }
  if (value.byModel !== undefined) {
    if (!Array.isArray(value.byModel) || value.byModel.length < 2 || value.byModel.length > 100) {return undefined;}
    const children: UsageAggregate[] = [];
    for (const entry of value.byModel) {
      if (!isRecord(entry) || entry.byModel !== undefined) {return undefined;}
      const child = normalizeUsageAggregate(entry);
      if (!child || child.count === 0 || children.some((other) => other.model === child.model)) {return undefined;}
      children.push(child);
    }
    if (normalized.model !== undefined) {return undefined;}
    if (normalized.officialEndpoint !== children.every((child) => child.officialEndpoint)) {return undefined;}
    const sum = createEmptyPhaseUsage();
    for (const child of children) {mergePhaseUsage(sum, child);}
    if (JSON.stringify(sum) !== JSON.stringify(totals)) {return undefined;}
    for (const phase of USAGE_PHASES) {
      const phaseSum = createEmptyPhaseUsage();
      for (const child of children) {
        if (child.byPhase[phase]) {mergePhaseUsage(phaseSum, child.byPhase[phase]!);}
      }
      if (JSON.stringify(phaseSum) !== JSON.stringify(normalized.byPhase[phase] ?? createEmptyPhaseUsage())) {return undefined;}
    }
    normalized.byModel = children;
  }
  return normalized;
}

export function isUsageAggregate(value: unknown): value is UsageAggregate {
  return normalizeUsageAggregate(value) !== undefined;
}

function normalizePhaseUsage(value: unknown): PhaseUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of ["requests", "reported", "reasoningReported", "cacheHitReported", "cacheMissReported"] as const) {
    if (!isNonNegativeCount(value[key])) {
      return undefined;
    }
  }
  const parsed: PhaseUsage = {
    requests: value.requests as number,
    reported: value.reported as number,
    reasoningReported: value.reasoningReported as number,
    cacheHitReported: value.cacheHitReported as number,
    cacheMissReported: value.cacheMissReported as number,
  };
  if (
    parsed.reported > parsed.requests ||
    parsed.reasoningReported > parsed.reported ||
    parsed.cacheHitReported > parsed.reported ||
    parsed.cacheMissReported > parsed.reported
  ) {
    return undefined;
  }
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheHitTokens", "cacheMissTokens", "totalTokens"] as const) {
    if (value[key] !== undefined) {
      if (!isNonNegativeCount(value[key])) {
        return undefined;
      }
      parsed[key] = value[key];
    }
  }
  if (
    (parsed.reported === 0) !== (parsed.inputTokens === undefined) ||
    (parsed.reported === 0) !== (parsed.outputTokens === undefined) ||
    (parsed.reported === 0) !== (parsed.totalTokens === undefined) ||
    (parsed.reasoningReported === 0) !== (parsed.reasoningTokens === undefined) ||
    (parsed.cacheHitReported === 0) !== (parsed.cacheHitTokens === undefined) ||
    (parsed.cacheMissReported === 0) !== (parsed.cacheMissTokens === undefined)
  ) {
    return undefined;
  }
  return parsed;
}

function phaseTotalsMatch(totals: PhaseUsage, byPhase: UsageAggregate["byPhase"]): boolean {
  const sum = createEmptyPhaseUsage();
  for (const phase of USAGE_PHASES) {
    const value = byPhase[phase];
    if (value) {
      mergePhaseUsage(sum, value);
    }
  }
  return JSON.stringify(sum) === JSON.stringify(totals);
}

function createEmptyPhaseUsage(): PhaseUsage {
  return {
    requests: 0,
    reported: 0,
    reasoningReported: 0,
    cacheHitReported: 0,
    cacheMissReported: 0,
  };
}

function mergePhaseUsage(target: PhaseUsage, source: PhaseUsage): void {
  target.requests = safeCountAdd(target.requests, source.requests);
  target.reported = safeCountAdd(target.reported, source.reported);
  target.reasoningReported = safeCountAdd(target.reasoningReported, source.reasoningReported);
  target.cacheHitReported = safeCountAdd(target.cacheHitReported, source.cacheHitReported);
  target.cacheMissReported = safeCountAdd(target.cacheMissReported, source.cacheMissReported);
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheHitTokens", "cacheMissTokens", "totalTokens"] as const) {
    if (source[key] !== undefined) {
      target[key] = safeCountAdd(target[key] ?? 0, source[key]);
    }
  }
}

function copyOptionalCount(source: Record<string, unknown>, target: ProviderUsage, key: "prompt_cache_hit_tokens" | "prompt_cache_miss_tokens"): void {
  if (isNonNegativeCount(source[key])) {
    target[key] = source[key];
  }
}

function safeCountAdd(left: number, right: number): number {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER;
}

function isOptionalNonNegativeNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isUsagePhase(value: unknown): value is UsagePhase {
  return USAGE_PHASES.includes(value as UsagePhase);
}

import {
  PRICE_CATALOG_VERSION,
  USAGE_PHASES,
  USAGE_SCHEMA_VERSION,
  type PhaseUsage,
  type ProviderUsage,
  type UsageAggregate,
  type UsagePhase,
} from "./UsageModels";
import { refreshUsageCost, roundUsageCost, supportsUsagePricing } from "./UsagePricing";

export {
  estimateAggregateCost,
  estimateReportedUsageCost,
  estimateUsageCost,
  isOfficialDeepSeekEndpoint,
} from "./UsagePricing";
export {
  formatUsageCost,
  isUsageCurrency,
  type UsageCurrency,
} from "./UsageCurrency";
export {
  isProviderUsage,
  isUsageAggregate,
  normalizeUsageAggregate,
  parseProviderUsage,
} from "./UsageNormalization";
export {
  PRICE_CATALOG_VERSION,
  USAGE_PHASES,
  USAGE_SCHEMA_VERSION,
  type PhaseUsage,
  type ProviderUsage,
  type UsageAggregate,
  type UsagePhase,
} from "./UsageModels";

export function createUsageAggregate(officialEndpoint: boolean, model?: string): UsageAggregate {
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    officialEndpoint,
    ...(model !== undefined ? { model } : {}),
    ...(officialEndpoint && supportsUsagePricing(model) ? { priceCatalogVersion: PRICE_CATALOG_VERSION } : {}),
    count: 0,
    ...createEmptyPhaseUsage(),
    byPhase: {},
  };
}

export function recordUsage(aggregate: UsageAggregate, phase: UsagePhase, usage?: ProviderUsage, model = aggregate.model): void {
  if (aggregate.byModel || (aggregate.count > 0 && model !== aggregate.model)) {
    if (!aggregate.byModel) {aggregate.byModel = [structuredClone(aggregate)];}
    let target = aggregate.byModel.find((entry) => entry.model === model);
    if (!target) {
      target = createUsageAggregate(aggregate.officialEndpoint, model);
      aggregate.byModel.push(target);
    }
    recordUsage(target, phase, usage, model);
    const merged = aggregateUsageAggregates(aggregate.byModel)!;
    for (const key of Object.keys(aggregate)) {delete (aggregate as unknown as Record<string, unknown>)[key];}
    Object.assign(aggregate, merged);
    return;
  }
  if (aggregate.count === 0 && model !== aggregate.model) {
    aggregate.model = model;
    delete aggregate.priceCatalogVersion;
    if (aggregate.officialEndpoint && supportsUsagePricing(model)) {aggregate.priceCatalogVersion = PRICE_CATALOG_VERSION;}
  }
  aggregate.count = safeAdd(aggregate.count, 1, aggregate);
  aggregate.requests = safeAdd(aggregate.requests, 1, aggregate);
  const phaseUsage = aggregate.byPhase[phase] ?? createEmptyPhaseUsage();
  phaseUsage.requests = safeAdd(phaseUsage.requests, 1, aggregate);
  aggregate.byPhase[phase] = phaseUsage;

  if (usage) {
    addReportedUsage(aggregate, usage, aggregate);
    addReportedUsage(phaseUsage, usage, aggregate);
  }
  refreshUsageCost(aggregate);
}

export function aggregateUsageAggregates(values: readonly UsageAggregate[]): UsageAggregate | undefined {
  const observed = values.flatMap((value) => value.byModel ?? [value]).filter((value) => value.count > 0);
  if (observed.length === 0) {
    return undefined;
  }

  const models = new Set(observed.map((value) => value.model));
  const officialEndpoint = observed.every((value) => value.officialEndpoint);
  const aggregate = createUsageAggregate(officialEndpoint, models.size === 1 ? [...models][0] : undefined);
  for (const value of observed) {
    if (value.saturated) {aggregate.saturated = true;}
    mergePhaseUsage(aggregate, value, aggregate);
    aggregate.count = safeAdd(aggregate.count, value.count, aggregate);
    for (const phase of USAGE_PHASES) {
      const phaseUsage = value.byPhase[phase];
      if (!phaseUsage) {
        continue;
      }
      const target = aggregate.byPhase[phase] ?? createEmptyPhaseUsage();
      mergePhaseUsage(target, phaseUsage, aggregate);
      aggregate.byPhase[phase] = target;
    }
  }

  const catalogVersions = new Set(observed.map((value) => value.priceCatalogVersion));
  const sharedCatalogVersion = catalogVersions.size === 1 ? observed[0].priceCatalogVersion : undefined;
  if (sharedCatalogVersion !== undefined) {
    aggregate.priceCatalogVersion = sharedCatalogVersion;
    const earliest = observed.map((value) => value.pricedAt).filter((value): value is string => value !== undefined).sort()[0];
    if (earliest) {aggregate.pricedAt = earliest;}
  } else {
    delete aggregate.priceCatalogVersion;
  }
  if (!aggregate.saturated && sharedCatalogVersion !== undefined && observed.every((value) => value.currency === "USD" && value.costUsd !== undefined)) {
    aggregate.currency = "USD";
    aggregate.costUsd = roundUsageCost(observed.reduce((sum, value) => sum + (value.costUsd ?? 0), 0));
  } else {
    delete aggregate.currency;
    delete aggregate.costUsd;
  }
  if (models.size > 1) {aggregate.byModel = aggregateUsageByModel(observed);}
  return aggregate;
}

export function aggregateUsageByModel(values: readonly UsageAggregate[]): UsageAggregate[] {
  const groups = new Map<string | undefined, UsageAggregate[]>();
  for (const value of values.flatMap((value) => value.byModel ?? [value])) {
    if (value.count === 0) {continue;}
    const group = groups.get(value.model) ?? [];
    group.push(value);
    groups.set(value.model, group);
  }

  return [...groups.values()].flatMap((group) => {
    const aggregate = aggregateUsageAggregates(group);
    return aggregate ? [aggregate] : [];
  });
}

export interface UsageBearingMessage {
  usage?: UsageAggregate;
  generationId?: string;
}

export interface ConversationUsageSnapshot {
  total?: UsageAggregate;
  byModel: UsageAggregate[];
}

export function summarizeConversationUsage(
  messages: readonly UsageBearingMessage[],
  pending?: UsageBearingMessage,
): ConversationUsageSnapshot {
  const values = messages.flatMap((message) => (message.usage ? [message.usage] : []));
  const pendingAggregate = pending?.usage;
  const pendingGenerationId = pending?.generationId;
  const alreadyCounted = pendingAggregate !== undefined && pendingGenerationId !== undefined &&
    messages.some((message) => message.generationId === pendingGenerationId && message.usage !== undefined);
  if (pendingAggregate && pendingAggregate.count > 0 && !alreadyCounted) {
    values.push(pendingAggregate);
  }
  return { total: aggregateUsageAggregates(values), byModel: aggregateUsageByModel(values) };
}

export function formatUsageSummary(aggregate: UsageAggregate): string {
  const phases = USAGE_PHASES
    .filter((phase) => aggregate.byPhase[phase])
    .map((phase) => `${phase}:${formatPhaseUsage(aggregate.byPhase[phase] as PhaseUsage)}`)
    .join(" ");
  return [
    `usage requests=${aggregate.count}`,
    `reported=${aggregate.reported}`,
    `input=${formatCount(aggregate.inputTokens)}`,
    `output=${formatCount(aggregate.outputTokens)}`,
    `reasoning=${formatCount(aggregate.reasoningTokens)}`,
    `cacheHit=${formatCount(aggregate.cacheHitTokens)}`,
    `cacheMiss=${formatCount(aggregate.cacheMissTokens)}`,
    `total=${formatCount(aggregate.totalTokens)}`,
    aggregate.costUsd !== undefined ? `costUsd=${aggregate.costUsd.toFixed(6)}` : "cost=unavailable",
    aggregate.priceCatalogVersion !== undefined ? `priceCatalog=${aggregate.priceCatalogVersion}` : "priceCatalog=unavailable",
    phases ? `[${phases}]` : "",
  ].filter(Boolean).join(" ");
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

function addReportedUsage(target: PhaseUsage, usage: ProviderUsage, aggregate: UsageAggregate): void {
  target.reported = safeAdd(target.reported, 1, aggregate);
  target.inputTokens = addOptional(target.inputTokens, usage.prompt_tokens, aggregate);
  target.outputTokens = addOptional(target.outputTokens, usage.completion_tokens, aggregate);
  target.totalTokens = addOptional(target.totalTokens, usage.total_tokens, aggregate);
  if (usage.reasoning_tokens !== undefined) {
    target.reasoningReported = safeAdd(target.reasoningReported, 1, aggregate);
    target.reasoningTokens = addOptional(target.reasoningTokens, usage.reasoning_tokens, aggregate);
  }
  if (usage.prompt_cache_hit_tokens !== undefined) {
    target.cacheHitReported = safeAdd(target.cacheHitReported, 1, aggregate);
    target.cacheHitTokens = addOptional(target.cacheHitTokens, usage.prompt_cache_hit_tokens, aggregate);
  }
  if (usage.prompt_cache_miss_tokens !== undefined) {
    target.cacheMissReported = safeAdd(target.cacheMissReported, 1, aggregate);
    target.cacheMissTokens = addOptional(target.cacheMissTokens, usage.prompt_cache_miss_tokens, aggregate);
  }
}

function mergePhaseUsage(target: PhaseUsage, source: PhaseUsage, aggregate?: UsageAggregate): void {
  target.requests = safeCountAdd(target.requests, source.requests, aggregate);
  target.reported = safeCountAdd(target.reported, source.reported, aggregate);
  target.reasoningReported = safeCountAdd(target.reasoningReported, source.reasoningReported, aggregate);
  target.cacheHitReported = safeCountAdd(target.cacheHitReported, source.cacheHitReported, aggregate);
  target.cacheMissReported = safeCountAdd(target.cacheMissReported, source.cacheMissReported, aggregate);
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheHitTokens", "cacheMissTokens", "totalTokens"] as const) {
    if (source[key] !== undefined) {
      target[key] = addOptional(target[key], source[key], aggregate);
    }
  }
}

function formatPhaseUsage(usage: PhaseUsage): string {
  return `${usage.reported}/${usage.requests},in=${formatCount(usage.inputTokens)},out=${formatCount(usage.outputTokens)},hit=${formatCount(usage.cacheHitTokens)},miss=${formatCount(usage.cacheMissTokens)}`;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "unavailable" : String(value);
}

function addOptional(current: number | undefined, value: number, aggregate?: UsageAggregate): number {
  return safeCountAdd(current ?? 0, value, aggregate);
}

function safeCountAdd(left: number, right: number, aggregate?: UsageAggregate): number {
  const result = left + right;
  if (Number.isSafeInteger(result)) {return result;}
  if (aggregate) {aggregate.saturated = true;}
  return Number.MAX_SAFE_INTEGER;
}

function safeAdd(left: number, right: number, aggregate: UsageAggregate): number {
  const result = left + right;
  if (Number.isSafeInteger(result)) {return result;}
  aggregate.saturated = true;
  return Number.MAX_SAFE_INTEGER;
}

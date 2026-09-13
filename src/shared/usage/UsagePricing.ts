import { getApiOrigin } from "@/shared/security/ApiOrigin";
import type { UsageCurrency } from "./UsageCurrency";
import { PRICE_CATALOG_VERSION, type ProviderUsage, type UsageAggregate } from "./UsageModels";

const OFFICIAL_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

interface PriceRate {
  inputMissPerMillion: number;
  inputHitPerMillion: number;
  outputPerMillion: number;
}

interface PriceTier {
  peak: PriceRate;
  offPeak: PriceRate;
}

const FLASH_MODEL_ID = "deepseek-flash";
const PRO_MODEL_ID = "deepseek-v4-pro";

const FLASH_OFF_PEAK_RATES: Readonly<Record<UsageCurrency, PriceRate>> = Object.freeze({
  usd: Object.freeze({
    inputMissPerMillion: 0.15,
    inputHitPerMillion: 0.003,
    outputPerMillion: 0.6,
  }),
  cny: Object.freeze({
    inputMissPerMillion: 1,
    inputHitPerMillion: 0.02,
    outputPerMillion: 4,
  }),
});

const PRO_OFF_PEAK_RATES: Readonly<Record<UsageCurrency, PriceRate>> = Object.freeze({
  usd: Object.freeze({
    inputMissPerMillion: 0.66,
    inputHitPerMillion: 0.022,
    outputPerMillion: 1.98,
  }),
  cny: Object.freeze({
    inputMissPerMillion: 4.5,
    inputHitPerMillion: 0.15,
    outputPerMillion: 13.5,
  }),
});

const MODEL_TIERS: Readonly<Record<string, Readonly<Record<UsageCurrency, PriceTier>>>> = Object.freeze({
  [FLASH_MODEL_ID]: Object.freeze(createTiers(FLASH_OFF_PEAK_RATES)),
  [PRO_MODEL_ID]: Object.freeze(createTiers(PRO_OFF_PEAK_RATES)),
});

export function isOfficialDeepSeekEndpoint(baseUrl: string): boolean {
  return getApiOrigin(baseUrl) === getApiOrigin(OFFICIAL_DEEPSEEK_BASE_URL);
}

export function supportsUsagePricing(model: string | undefined): boolean {
  return resolvePriceTier(model, "usd") !== undefined;
}

export function estimateUsageCost(
  usage: ProviderUsage | UsageAggregate,
  model: string | undefined,
  at?: Date,
  currency: UsageCurrency = "usd",
): number | undefined {
  const instant = resolvePricedInstant(usage, at);
  const tier = resolvePriceTier(model, currency);
  if (!tier) {
    return undefined;
  }
  if ("saturated" in usage && usage.saturated) {return undefined;}

  const isAggregate = "count" in usage;
  const cacheHit = isAggregate ? usage.cacheHitTokens : usage.prompt_cache_hit_tokens;
  const cacheMiss = isAggregate ? usage.cacheMissTokens : usage.prompt_cache_miss_tokens;
  const output = isAggregate ? usage.outputTokens : usage.completion_tokens;
  if (cacheHit === undefined || cacheMiss === undefined || output === undefined) {
    return undefined;
  }
  if (isAggregate && (
    usage.count === 0 ||
    usage.reported !== usage.count ||
    usage.cacheHitReported !== usage.count ||
    usage.cacheMissReported !== usage.count
  )) {
    return undefined;
  }

  return calculateUsageCost(selectRate(tier, instant), cacheHit, cacheMiss, output);
}

export function estimateReportedUsageCost(
  usage: UsageAggregate,
  at?: Date,
  currency: UsageCurrency = "usd",
): number | undefined {
  if (usage.byModel) {
    if (usage.saturated || !usage.officialEndpoint) {return undefined;}
    const costs = usage.byModel.map((entry) => estimateReportedUsageCost(entry, at, currency));
    return costs.length > 0 && costs.every((cost) => cost !== undefined)
      ? roundUsageCost(costs.reduce((sum, cost) => sum + (cost ?? 0), 0))
      : undefined;
  }
  if (
    !usage.officialEndpoint ||
    usage.saturated ||
    usage.priceCatalogVersion !== PRICE_CATALOG_VERSION ||
    usage.reported === 0 ||
    usage.cacheHitReported !== usage.reported ||
    usage.cacheMissReported !== usage.reported ||
    usage.cacheHitTokens === undefined ||
    usage.cacheMissTokens === undefined ||
    usage.outputTokens === undefined
  ) {
    return undefined;
  }
  const instant = resolvePricedInstant(usage, at);
  const tier = resolvePriceTier(usage.model, currency);
  return tier
    ? calculateUsageCost(selectRate(tier, instant), usage.cacheHitTokens, usage.cacheMissTokens, usage.outputTokens)
    : undefined;
}

export function estimateAggregateCost(
  usage: UsageAggregate,
  currency: UsageCurrency = "usd",
  at?: Date,
): number | undefined {
  if (usage.byModel) {return estimateReportedUsageCost(usage, at, currency);}
  return currency === "usd"
    ? usage.costUsd ?? estimateReportedUsageCost(usage, at)
    : estimateReportedUsageCost(usage, at, currency);
}

export function refreshUsageCost(aggregate: UsageAggregate, at?: Date): void {
  const instant = resolvePricedInstant(aggregate, at);
  const cost = aggregate.officialEndpoint ? estimateUsageCost(aggregate, aggregate.model, instant) : undefined;
  if (cost === undefined) {
    delete aggregate.costUsd;
    delete aggregate.currency;
    return;
  }
  aggregate.priceCatalogVersion = PRICE_CATALOG_VERSION;
  aggregate.pricedAt = instant.toISOString();
  aggregate.currency = "USD";
  aggregate.costUsd = cost;
}

function resolvePricedInstant(usage: ProviderUsage | UsageAggregate, at?: Date): Date {
  if (at) {return at;}
  const stored = "pricedAt" in usage && usage.pricedAt ? new Date(usage.pricedAt) : undefined;
  return stored && !Number.isNaN(stored.getTime()) ? stored : new Date();
}

export function roundUsageCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isPeakPricingHour(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) {return false;}
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function createTiers(rates: Readonly<Record<UsageCurrency, PriceRate>>): Readonly<Record<UsageCurrency, PriceTier>> {
  return {
    usd: createPriceTier(rates.usd),
    cny: createPriceTier(rates.cny),
  };
}

function createPriceTier(offPeak: PriceRate): PriceTier {
  return {
    offPeak,
    peak: {
      inputMissPerMillion: offPeak.inputMissPerMillion * 2,
      inputHitPerMillion: offPeak.inputHitPerMillion * 2,
      outputPerMillion: offPeak.outputPerMillion * 2,
    },
  };
}

function resolvePriceTier(model: string | undefined, currency: UsageCurrency): PriceTier | undefined {
  return model ? MODEL_TIERS[model]?.[currency] : undefined;
}

function selectRate(tier: PriceTier, at: Date): PriceRate {
  return isPeakPricingHour(at) ? tier.peak : tier.offPeak;
}

function calculateUsageCost(rate: PriceRate, cacheHit: number, cacheMiss: number, output: number): number {
  return roundUsageCost(
    cacheMiss / 1_000_000 * rate.inputMissPerMillion +
    cacheHit / 1_000_000 * rate.inputHitPerMillion +
    output / 1_000_000 * rate.outputPerMillion,
  );
}

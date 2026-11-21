export type UsageCurrency = "usd" | "cny";

export const DEFAULT_USAGE_CURRENCY: UsageCurrency = "usd";

export function isUsageCurrency(value: unknown): value is UsageCurrency {
  return value === "usd" || value === "cny";
}

export function normalizeUsageCurrency(value: unknown): UsageCurrency {
  return isUsageCurrency(value) ? value : DEFAULT_USAGE_CURRENCY;
}

export function usageCurrencyCode(currency: UsageCurrency): "USD" | "CNY" {
  return currency === "cny" ? "CNY" : "USD";
}

export interface UsageCostFormatOptions {
  currency: UsageCurrency;
  locale: string;
  unavailable: string;
  partial?: boolean;
}

export function formatUsageCost(value: number | undefined, options: UsageCostFormatOptions): string {
  if (value === undefined) {
    return options.unavailable;
  }
  const formatted = new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: usageCurrencyCode(options.currency),
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 6 : 2,
  }).format(value);
  return options.partial ? `≥ ${formatted}` : formatted;
}

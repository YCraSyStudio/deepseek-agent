import * as assert from "node:assert";
import {
  DEFAULT_USAGE_CURRENCY,
  formatUsageCost,
  isUsageCurrency,
  normalizeUsageCurrency,
  usageCurrencyCode,
} from "@/shared/usage/UsageCurrency";

suite("usage display currency", () => {
  test("accepts only the currencies DeepSeek publishes prices for", () => {
    assert.strictEqual(isUsageCurrency("usd"), true);
    assert.strictEqual(isUsageCurrency("cny"), true);
    assert.strictEqual(isUsageCurrency("USD"), false);
    assert.strictEqual(isUsageCurrency("eur"), false);
    assert.strictEqual(isUsageCurrency(undefined), false);

    assert.strictEqual(normalizeUsageCurrency("cny"), "cny");
    assert.strictEqual(normalizeUsageCurrency("eur"), DEFAULT_USAGE_CURRENCY);
    assert.strictEqual(normalizeUsageCurrency(undefined), "usd");
    assert.strictEqual(usageCurrencyCode("usd"), "USD");
    assert.strictEqual(usageCurrencyCode("cny"), "CNY");
  });

  test("formats each currency with its narrow symbol and the locale separators", () => {
    const usd = formatUsageCost(1.5, { currency: "usd", locale: "en", unavailable: "unavailable" });
    const cny = formatUsageCost(1.5, { currency: "cny", locale: "en", unavailable: "unavailable" });
    assert.ok(usd.includes("$") && usd.includes("1.50"), usd);
    assert.ok(cny.includes("¥") && cny.includes("1.50"), cny);
    assert.ok(!cny.includes("CN"), `expected the narrow symbol, got ${cny}`);

    const spanish = formatUsageCost(1.5, { currency: "usd", locale: "es", unavailable: "unavailable" });
    assert.ok(spanish.includes("1,50"), spanish);
  });

  test("keeps sub-cent precision and marks lower bounds", () => {
    const small = formatUsageCost(0.000123, { currency: "usd", locale: "en", unavailable: "unavailable" });
    assert.ok(small.includes("0.000123"), small);
    assert.strictEqual(
      formatUsageCost(0.25, { currency: "cny", locale: "en", unavailable: "unavailable", partial: true }).startsWith("≥ "),
      true,
    );
  });

  test("reports the placeholder when the cost is unavailable", () => {
    assert.strictEqual(formatUsageCost(undefined, { currency: "cny", locale: "en", unavailable: "unavailable" }), "unavailable");
  });
});

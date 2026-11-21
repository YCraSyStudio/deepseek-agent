import * as assert from "node:assert";
import {
  aggregateUsageAggregates,
  aggregateUsageByModel,
  createUsageAggregate,
  estimateAggregateCost,
  estimateUsageCost,
  estimateReportedUsageCost,
  formatUsageSummary,
  isOfficialDeepSeekEndpoint,
  isProviderUsage,
  normalizeUsageAggregate,
  parseProviderUsage,
  PRICE_CATALOG_VERSION,
  recordUsage,
  summarizeConversationUsage,
  USAGE_SCHEMA_VERSION,
} from "@/shared/usage/Usage";

const PEAK = new Date("2026-09-10T02:00:00Z");
const OFF_PEAK = new Date("2026-09-10T12:00:00Z");

suite("usage observability", () => {
  test("attributes mixed-model requests without charging an unknown model at Flash rates", () => {
    const aggregate = createUsageAggregate(true, "deepseek-flash");
    recordUsage(aggregate, "tool_round", completeUsage(100, 20, 80, 20), "deepseek-flash");
    recordUsage(aggregate, "security_review", completeUsage(50, 10, 40, 10), "future-model");
    recordUsage(aggregate, "context_summary", undefined, "future-model");
    recordUsage(aggregate, "primary", completeUsage(100, 20, 80, 20), "deepseek-flash");
    assert.strictEqual(aggregate.count, 4);
    assert.strictEqual(aggregate.reported, 3);
    assert.strictEqual(aggregate.model, undefined);
    const models = aggregateUsageByModel([aggregate]);
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models.find((entry) => entry.model === "deepseek-flash")?.count, 2);
    assert.strictEqual(models.find((entry) => entry.model === "future-model")?.byPhase.context_summary?.reported, 0);
    assert.strictEqual(estimateAggregateCost(aggregate, "usd", OFF_PEAK), undefined);
    assert.strictEqual(estimateAggregateCost(aggregate, "cny", OFF_PEAK), undefined);
    assert.deepStrictEqual(normalizeUsageAggregate(JSON.parse(JSON.stringify(aggregate))), aggregate);
    const conversation = summarizeConversationUsage([{ usage: aggregate }]);
    assert.strictEqual(conversation.total?.count, 4);
    assert.strictEqual(conversation.byModel.length, 2);
  });

  test("rejects inconsistent or recursively nested model breakdowns", () => {
    const aggregate = createUsageAggregate(true, "deepseek-flash");
    recordUsage(aggregate, "tool_round", completeUsage(100, 20, 80, 20), "deepseek-flash");
    recordUsage(aggregate, "security_review", undefined, "future-model");
    const invalid = structuredClone(aggregate);
    invalid.byModel![0].byModel = [structuredClone(invalid.byModel![1])];
    assert.strictEqual(normalizeUsageAggregate(invalid), undefined);
    aggregate.byModel![1].count++;
    assert.strictEqual(normalizeUsageAggregate(aggregate), undefined);
  });

  test("uses the actual first request model instead of an unused configured primary", () => {
    const aggregate = createUsageAggregate(true, "future-model");
    recordUsage(aggregate, "context_summary", completeUsage(50, 10, 40, 10), "deepseek-flash");
    assert.strictEqual(aggregate.model, "deepseek-flash");
    assert.strictEqual(aggregate.byModel, undefined);
    assert.ok(estimateAggregateCost(aggregate) !== undefined);
  });
  suite("parseProviderUsage", () => {
    test("normalizes the documented DeepSeek cache and nested reasoning fields", () => {
      const usage = parseProviderUsage({
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        prompt_cache_hit_tokens: 70,
        prompt_cache_miss_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 12 },
      });
      assert.deepStrictEqual(usage, {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        reasoning_tokens: 12,
        prompt_cache_hit_tokens: 70,
        prompt_cache_miss_tokens: 30,
      });
    });

    test("keeps valid required usage while treating malformed optional fields as unavailable", () => {
      const usage = parseProviderUsage({
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
        prompt_cache_hit_tokens: "invalid",
        completion_tokens_details: { reasoning_tokens: -1 },
      });
      assert.deepStrictEqual(usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
      assert.ok(isProviderUsage(usage));
    });

    test("rejects malformed required usage without failing its enclosing response", () => {
      assert.strictEqual(parseProviderUsage(undefined), undefined);
      assert.strictEqual(parseProviderUsage(null), undefined);
      assert.strictEqual(parseProviderUsage("tokens"), undefined);
      assert.strictEqual(parseProviderUsage({}), undefined);
      assert.strictEqual(parseProviderUsage({ prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 }), undefined);
      assert.strictEqual(parseProviderUsage({ prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3 }), undefined);
    });
  });

  test("recognizes only the official DeepSeek origin", () => {
    assert.strictEqual(isOfficialDeepSeekEndpoint("https://api.deepseek.com"), true);
    assert.strictEqual(isOfficialDeepSeekEndpoint("https://api.deepseek.com/v1"), true);
    assert.strictEqual(isOfficialDeepSeekEndpoint("https://example.com/api"), false);
    assert.strictEqual(isOfficialDeepSeekEndpoint("http://localhost:11434"), false);
  });

  suite("aggregation and availability", () => {
    test("counts each request once and keeps absent usage unavailable", () => {
      const aggregate = createUsageAggregate(true, "deepseek-flash");
      recordUsage(aggregate, "tool_round", {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      });
      recordUsage(aggregate, "tool_round", undefined);
      recordUsage(aggregate, "security_review", {
        prompt_tokens: 30,
        completion_tokens: 5,
        total_tokens: 35,
      });

      assert.strictEqual(aggregate.count, 3);
      assert.strictEqual(aggregate.reported, 2);
      assert.strictEqual(aggregate.inputTokens, 130);
      assert.strictEqual(aggregate.outputTokens, 25);
      assert.strictEqual(aggregate.cacheHitTokens, 80);
      assert.strictEqual(aggregate.cacheMissTokens, 20);
      assert.strictEqual(aggregate.byPhase.tool_round?.requests, 2);
      assert.strictEqual(aggregate.byPhase.tool_round?.reported, 1);
      assert.strictEqual(aggregate.costUsd, undefined, "partial usage must not produce a partial cost");
    });

    test("does not turn entirely absent usage into zero", () => {
      const aggregate = createUsageAggregate(false, "custom-model");
      recordUsage(aggregate, "primary", undefined);
      assert.strictEqual(aggregate.count, 1);
      assert.strictEqual(aggregate.reported, 0);
      assert.strictEqual(aggregate.inputTokens, undefined);
      assert.strictEqual(aggregate.cacheMissTokens, undefined);
      assert.strictEqual(aggregate.costUsd, undefined);
    });

    test("combines generation aggregates into a conversation total", () => {
      const first = createUsageAggregate(true, "deepseek-flash");
      const second = createUsageAggregate(true, "deepseek-flash");
      recordUsage(first, "primary", completeUsage(100, 20, 75, 25));
      recordUsage(second, "security_review", completeUsage(50, 10, 40, 10));
      const conversation = aggregateUsageAggregates([first, second]);
      assert.strictEqual(conversation?.count, 2);
      assert.strictEqual(conversation?.reported, 2);
      assert.strictEqual(conversation?.inputTokens, 150);
      assert.strictEqual(conversation?.byPhase.security_review?.requests, 1);
      assert.strictEqual(conversation?.priceCatalogVersion, PRICE_CATALOG_VERSION);
      assert.strictEqual(conversation?.costUsd, rounded((first.costUsd ?? 0) + (second.costUsd ?? 0)));
    });

    test("keeps separate totals when a conversation changes models", () => {
      const flash = createUsageAggregate(true, "deepseek-flash");
      const custom = createUsageAggregate(true, "custom-model");
      recordUsage(flash, "primary", completeUsage(100, 20, 75, 25));
      recordUsage(custom, "tool_round", completeUsage(50, 10, 40, 10));

      const byModel = aggregateUsageByModel([flash, custom]);
      assert.deepStrictEqual(byModel.map((value) => [value.model, value.count, value.totalTokens]), [
        ["deepseek-flash", 1, 120],
        ["custom-model", 1, 60],
      ]);
    });

    test("totals a conversation from every stored message and the unpersisted run", () => {
      const stored = createUsageAggregate(true, "deepseek-flash");
      recordUsage(stored, "primary", completeUsage(100, 20, 75, 25));
      const running = createUsageAggregate(true, "deepseek-flash");
      recordUsage(running, "tool_round", completeUsage(50, 10, 40, 10));
      const messages = [{ generationId: "old", usage: stored }, { generationId: "older-without-usage" }];

      const snapshot = summarizeConversationUsage(messages, { generationId: "running", usage: running });
      assert.strictEqual(snapshot.total?.count, 2);
      assert.strictEqual(snapshot.total?.inputTokens, 150);
      assert.deepStrictEqual(snapshot.byModel.map((value) => value.count), [2]);

      const persisted = summarizeConversationUsage(
        [...messages, { generationId: "running", usage: running }],
        { generationId: "running", usage: running },
      );
      assert.strictEqual(persisted.total?.count, 2);
      assert.strictEqual(persisted.total?.inputTokens, 150);
    });

    test("reports no total instead of a zero total for a conversation without usage", () => {
      const snapshot = summarizeConversationUsage([{ generationId: "empty" }]);
      assert.strictEqual(snapshot.total, undefined);
      assert.deepStrictEqual(snapshot.byModel, []);
    });
  });

  suite("official price catalog", () => {
    test("prices DeepSeek V4.1 Flash at the documented peak and off-peak rates", () => {
      const usage = completeUsage(1_000, 100, 700, 300);
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-flash", OFF_PEAK),
        rounded((300 * 0.15 + 700 * 0.003 + 100 * 0.6) / 1_000_000),
      );
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-flash", PEAK),
        rounded((300 * 0.3 + 700 * 0.006 + 100 * 1.2) / 1_000_000),
      );
      assert.strictEqual(estimateUsageCost(usage, "deepseek-v4-flash", OFF_PEAK), undefined);
      assert.strictEqual(estimateUsageCost(usage, "deepseek-v4-flash-vision-exp", OFF_PEAK), undefined);
    });

    test("prices DeepSeek V4 Pro at the documented peak and off-peak rates", () => {
      const usage = completeUsage(1_000, 100, 700, 300);
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-v4-pro", OFF_PEAK),
        rounded((300 * 0.66 + 700 * 0.022 + 100 * 1.98) / 1_000_000),
      );
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-v4-pro", PEAK),
        rounded((300 * 1.32 + 700 * 0.044 + 100 * 3.96) / 1_000_000),
      );
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-v4-pro", OFF_PEAK, "cny"),
        rounded((300 * 4.5 + 700 * 0.15 + 100 * 13.5) / 1_000_000),
      );
    });

    test("prices the same tokens from DeepSeek's documented CNY table", () => {
      const usage = completeUsage(1_000, 100, 700, 300);
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-flash", OFF_PEAK, "cny"),
        rounded((300 * 1 + 700 * 0.02 + 100 * 4) / 1_000_000),
      );
      assert.strictEqual(
        estimateUsageCost(usage, "deepseek-flash", PEAK, "cny"),
        rounded((300 * 2 + 700 * 0.04 + 100 * 8) / 1_000_000),
      );
    });

    test("reprices an aggregate in the requested display currency", () => {
      const complete = createUsageAggregate(true, "deepseek-flash");
      recordUsage(complete, "primary", completeUsage(1_000, 100, 700, 300));
      assert.strictEqual(estimateAggregateCost(complete, "usd", OFF_PEAK), complete.costUsd);
      assert.strictEqual(
        estimateAggregateCost(complete, "cny", OFF_PEAK),
        rounded((300 * 1 + 700 * 0.02 + 100 * 4) / 1_000_000),
      );

      const partial = createUsageAggregate(true, "deepseek-flash");
      recordUsage(partial, "primary", completeUsage(1_000, 100, 700, 300));
      recordUsage(partial, "primary", undefined);
      assert.strictEqual(partial.costUsd, undefined);
      assert.strictEqual(
        estimateAggregateCost(partial, "cny", OFF_PEAK),
        rounded((300 * 1 + 700 * 0.02 + 100 * 4) / 1_000_000),
      );
      assert.strictEqual(estimateAggregateCost(createUsageAggregate(false, "deepseek-flash"), "cny", OFF_PEAK), undefined);
    });

    test("prices the reported subset as a lower bound when some requests omit usage", () => {
      const aggregate = createUsageAggregate(true, "deepseek-flash");
      recordUsage(aggregate, "tool_round", completeUsage(1_000, 100, 700, 300));
      recordUsage(aggregate, "tool_round", undefined);

      assert.strictEqual(aggregate.costUsd, undefined, "the persisted exact cost remains unavailable");
      assert.strictEqual(
        estimateReportedUsageCost(aggregate, OFF_PEAK),
        rounded((300 * 0.15 + 700 * 0.003 + 100 * 0.6) / 1_000_000),
      );
      assert.strictEqual(
        estimateReportedUsageCost(aggregate, PEAK),
        rounded((300 * 0.3 + 700 * 0.006 + 100 * 1.2) / 1_000_000),
      );
    });

    test("does not estimate unknown models or usage without cache attribution", () => {
      const incomplete = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
      assert.strictEqual(estimateUsageCost(incomplete, "deepseek-flash", OFF_PEAK), undefined);
      assert.strictEqual(estimateUsageCost(completeUsage(10, 2, 5, 5), "llama-3", OFF_PEAK), undefined);
    });

    test("never guesses a price for custom endpoints", () => {
      const aggregate = createUsageAggregate(false, "deepseek-flash");
      recordUsage(aggregate, "primary", completeUsage(10, 5, 5, 5));
      assert.strictEqual(aggregate.costUsd, undefined);
      assert.strictEqual(aggregate.currency, undefined);
      assert.strictEqual(aggregate.priceCatalogVersion, undefined);
      assert.strictEqual(estimateReportedUsageCost(aggregate, OFF_PEAK), undefined);
    });
  });

  suite("persistence validation", () => {
    test("round-trips a consistent aggregate", () => {
      const aggregate = createUsageAggregate(true, "deepseek-flash");
      recordUsage(aggregate, "primary", completeUsage(10, 5, 6, 4));
      const restored = normalizeUsageAggregate(JSON.parse(JSON.stringify(aggregate)));
      assert.deepStrictEqual(restored, aggregate);
    });

    test("rejects malformed or internally inconsistent aggregates", () => {
      const aggregate = createUsageAggregate(false, "custom");
      recordUsage(aggregate, "primary", completeUsage(10, 5, 6, 4));
      assert.strictEqual(normalizeUsageAggregate(undefined), undefined);
      assert.strictEqual(normalizeUsageAggregate({ schemaVersion: USAGE_SCHEMA_VERSION + 1 }), undefined);
      assert.strictEqual(normalizeUsageAggregate({ ...aggregate, count: 2 }), undefined);
      assert.strictEqual(normalizeUsageAggregate({ ...aggregate, inputTokens: 999 }), undefined);
      assert.strictEqual(normalizeUsageAggregate({ ...aggregate, byPhase: { unknown_phase: aggregate.byPhase.primary } }), undefined);
    });

    test("rejects required totals when no request has reported usage", () => {
      const aggregate = createUsageAggregate(true, "deepseek-flash");
      recordUsage(aggregate, "primary");
      const inconsistent = structuredClone(aggregate);
      inconsistent.inputTokens = 12;
      assert.strictEqual(normalizeUsageAggregate(inconsistent), undefined);
    });
  });

  test("saturates unsafe counters and stops calculating cost", () => {
    const aggregate = createUsageAggregate(true, "deepseek-flash");
    const maximumUsage = {
      prompt_tokens: Number.MAX_SAFE_INTEGER,
      completion_tokens: Number.MAX_SAFE_INTEGER,
      total_tokens: Number.MAX_SAFE_INTEGER,
      prompt_cache_hit_tokens: Number.MAX_SAFE_INTEGER,
      prompt_cache_miss_tokens: Number.MAX_SAFE_INTEGER,
    };
    recordUsage(aggregate, "primary", maximumUsage);
    recordUsage(aggregate, "primary", maximumUsage);

    assert.strictEqual(aggregate.saturated, true);
    assert.strictEqual(aggregate.inputTokens, Number.MAX_SAFE_INTEGER);
    assert.strictEqual(aggregate.costUsd, undefined);
  });

  test("formats a redacted summary with explicit unavailable values", () => {
    const aggregate = createUsageAggregate(false, "custom");
    recordUsage(aggregate, "primary", undefined);
    const summary = formatUsageSummary(aggregate);
    assert.ok(summary.includes("requests=1 reported=0 input=unavailable"));
    assert.ok(summary.includes("cacheMiss=unavailable"));
    assert.ok(!summary.includes("command") && !summary.includes("path"));
  });
});

function completeUsage(prompt: number, completion: number, hit: number, miss: number) {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
  };
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

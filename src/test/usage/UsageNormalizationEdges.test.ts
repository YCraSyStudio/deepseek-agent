import assert from "node:assert/strict";
import { normalizeUsageAggregate } from "@/shared/usage/UsageNormalization";

suite("persisted usage normalization edges", () => {
  const phase = { requests: 1, reported: 1, reasoningReported: 0, cacheHitReported: 0, cacheMissReported: 0, inputTokens: 2, outputTokens: 1, totalTokens: 3 };
  const single = (model = "model-a") => ({ schemaVersion: 1, officialEndpoint: true, model, count: 1, ...phase, byPhase: { primary: { ...phase } } });
  const mixed = () => {
    const totals = { ...phase, requests: 2, reported: 2, inputTokens: 4, outputTokens: 2, totalTokens: 6 };
    return { schemaVersion: 1, officialEndpoint: true, count: 2, ...totals, byPhase: { primary: { ...totals } }, byModel: [single(), single("model-b")] };
  };
  test("retains valid pricing metadata and saturation without retaining mutable input references", () => {
    const input = { ...single(), priceCatalogVersion: 2, pricedAt: "2026-09-10T12:00:00.000Z", currency: "USD", costUsd: 0, saturated: true };
    const output = normalizeUsageAggregate(input)!;
    assert.ok(output); assert.equal(output.saturated, true); assert.equal(output.costUsd, 0);
    assert.equal(output.currency, "USD"); assert.equal(output.pricedAt, input.pricedAt);
    output.byPhase.primary!.inputTokens = 999;
    assert.equal(input.byPhase.primary.inputTokens, 2);
  });
  test("rejects malformed or unsupported model, catalog, currency and cost metadata", () => {
    for (const patch of [{ model: 1 }, { model: "x".repeat(257) }, { priceCatalogVersion: "2" }, { priceCatalogVersion: 999 },
      { currency: "EUR" }, { costUsd: -1 }, { costUsd: Number.POSITIVE_INFINITY }, { costUsd: "1" },
      { currency: "USD" }, { costUsd: 1 }, { pricedAt: 1 }, { pricedAt: "x".repeat(41) },
      { pricedAt: "not-a-date" }, { pricedAt: "2026-09-10T12:00:00+00:00" }]) {
      assert.equal(normalizeUsageAggregate({ ...single(), ...patch }), undefined);
    }
  });
  test("rejects missing or invalid phase counters and impossible reporting proportions", () => {
    for (const key of ["requests", "reported", "reasoningReported", "cacheHitReported", "cacheMissReported"]) {
      assert.equal(normalizeUsageAggregate({ ...single(), [key]: -1 }), undefined);
    }
    for (const patch of [{ reported: 2 }, { reasoningReported: 2 }, { cacheHitReported: 2 }, { cacheMissReported: 2 },
      { inputTokens: -1 }, { outputTokens: 1.5 }, { totalTokens: Number.MAX_SAFE_INTEGER + 1 },
      { reasoningTokens: -1 }, { cacheHitTokens: -1 }, { cacheMissTokens: -1 }]) {
      assert.equal(normalizeUsageAggregate({ ...single(), ...patch }), undefined);
    }
    for (const primary of [null, { ...phase, requests: 0, reported: 0, inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      { ...phase, inputTokens: -1 }]) {
      assert.equal(normalizeUsageAggregate({ ...single(), byPhase: { primary } }), undefined);
    }
  });
  test("requires bounded flat model breakdowns containing nonempty distinct models", () => {
    for (const byModel of [{}, [], [single()], Array(101).fill(single()), [null, single()],
      [{ ...single(), byModel: [] }, single("model-b")], [single(), single()],
      [single(), { schemaVersion: 1, officialEndpoint: true, model: "empty", count: 0, requests: 0, reported: 0, reasoningReported: 0, cacheHitReported: 0, cacheMissReported: 0, byPhase: {} }]]) {
      assert.equal(normalizeUsageAggregate({ ...mixed(), byModel }), undefined);
    }
    assert.equal(normalizeUsageAggregate({ ...mixed(), model: "parent-must-not-name-one-model" }), undefined);
  });
  test("checks model breakdown endpoint attribution, overall totals and phase allocation independently", () => {
    assert.ok(normalizeUsageAggregate(mixed()));
    assert.equal(normalizeUsageAggregate({ ...mixed(), officialEndpoint: false }), undefined);
    const wrongTotal = mixed(); wrongTotal.byModel[1].inputTokens = 3; wrongTotal.byModel[1].byPhase.primary.inputTokens = 3;
    assert.equal(normalizeUsageAggregate(wrongTotal), undefined);
    const allocation = mixed();
    assert.equal(normalizeUsageAggregate({ ...allocation, byModel: [allocation.byModel[0], { ...allocation.byModel[1], byPhase: { tool_round: { ...phase } } }] }), undefined);
  });
  test("saturates summed request counts safely at the maximum supported integer", () => {
    const empty = { requests: 0, reported: 0, reasoningReported: 0, cacheHitReported: 0, cacheMissReported: 0 };
    const maximum = { ...empty, requests: Number.MAX_SAFE_INTEGER };
    const value = { schemaVersion: 1, officialEndpoint: false, count: Number.MAX_SAFE_INTEGER, ...maximum,
      byPhase: { primary: maximum, tool_round: { ...empty, requests: 1 } }, saturated: true };
    const output = normalizeUsageAggregate(value);
    assert.ok(output); assert.equal(output.count, Number.MAX_SAFE_INTEGER); assert.equal(output.saturated, true);
  });
});

import assert from "node:assert/strict";
import { act, createElement, type ComponentProps } from "react";
import UsagePicker, { UsagePopover } from "@webview/views/chatView/sections/inputArea/inputFooter/UsagePicker";
import ModelReasoningPicker from "@webview/views/chatView/sections/inputArea/inputFooter/ModelReasoningPicker";
import { createUsageAggregate, recordUsage, USAGE_PHASES, type UsageAggregate } from "@/shared/usage/Usage";
import type { ContextWindowStatus } from "@/contracts";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

type UsageProps = ComponentProps<typeof UsagePicker>;

suite("composer usage and model menus", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  async function picker(props: UsageProps = {}) { await h.render(createElement(UsagePicker, props)); }
  async function popover(props: Partial<ComponentProps<typeof UsagePopover>> = {}) {
    await h.render(createElement(UsagePopover, { usage: usage(), usageByModel: [], ...props }));
  }

  test("unmeasured or zero-request usage cannot open an empty panel", async () => {
    await picker(); assert.equal(h.query<HTMLButtonElement>(".usageTrigger").disabled, true);
    assert.match(h.query(".contextRing").getAttribute("class")!, /tone-idle/);
    await h.click(".usageTrigger"); assert.equal(h.container.querySelector(".usagePopover"), null);
    await picker({ usage: createUsageAggregate(true) }); assert.equal(h.query<HTMLButtonElement>(".usageTrigger").disabled, true);
  });

  test("opening, resizing, outside clicks and Escape preserve accessible menu state", async () => {
    await picker({ usage: usage() }); await h.click(".usageTrigger");
    assert.equal(h.query(".usageTrigger").getAttribute("aria-expanded"), "true");
    assert.equal(h.query<HTMLElement>(".usagePopover").style.maxHeight, "180px");
    Object.defineProperty(h.query(".usageTrigger"), "getBoundingClientRect", { value: () => ({ top: 450 }) });
    await act(async () => { window.dispatchEvent(new h.dom.window.Event("resize")); });
    assert.equal(h.query<HTMLElement>(".usagePopover").style.maxHeight, "434px");
    await act(async () => { h.query(".usagePopover").dispatchEvent(new h.dom.window.Event("pointerdown", { bubbles: true })); });
    assert.ok(h.container.querySelector(".usagePopover"));
    await h.key(".usageTrigger", "Escape"); assert.equal(h.container.querySelector(".usagePopover"), null);
    await h.click(".usageTrigger");
    await act(async () => { h.dom.window.document.body.dispatchEvent(new h.dom.window.Event("pointerdown", { bubbles: true })); });
    assert.equal(h.container.querySelector(".usagePopover"), null);
    await h.click(".usageTrigger"); await h.click(".usageTrigger");
    assert.equal(h.container.querySelector(".usagePopover"), null);
  });

  for (const [usedTokens, tone] of [[0, "idle"], [20, "normal"], [70, "warning"], [95, "danger"], [150, "danger"]] as const) {
    test(`context ring reports ${usedTokens}% with the ${tone} threshold`, async () => {
      await picker({ usage: usage(), contextWindow: context({ usedTokens }) });
      assert.match(h.query(".contextRing").getAttribute("class")!, new RegExp(`tone-${tone}`));
      assert.match(h.query(".usageTrigger").getAttribute("aria-label")!, new RegExp(`${usedTokens}%`));
      await h.click(".usageTrigger");
      assert.equal(h.query(".usageContextShare").textContent, `${Math.min(100, usedTokens)}%`);
      assert.equal(h.query<HTMLElement>(".usageContextBar span").style.width, `${Math.min(100, usedTokens)}%`);
    });
  }

  test("estimated zero-sized contexts avoid division errors and indicate pending compaction", async () => {
    await picker({ usage: usage(), contextWindow: context({ windowTokens: 0, source: "estimated" }), compaction: { pending: true, onCompact: () => assert.fail("Pending compaction must be disabled") } });
    assert.match(h.query(".contextRing").getAttribute("class")!, /estimated.*pending/);
    assert.match(h.query(".usageTrigger").getAttribute("aria-label")!, /0%.*estimated/i);
    await h.click(".usageTrigger"); assert.equal(h.query<HTMLButtonElement>(".usageCompactAction").disabled, true);
    assert.equal(h.query(".usageContextShare").textContent, "0%");
    await h.click(".usageCompactAction");
  });

  test("costs, cache hit rate, reasoning, requests and model names are visible", async () => {
    const value = usage(); value.costUsd = 1.25;
    await popover({ usage: value });
    assert.match(h.query(".usageHero").textContent!, /1\.3K.*\$1\.25/);
    assert.match(h.query(".usageMetricGrid").textContent!, /75%/);
    assert.match(h.query(".usagePopoverModel").textContent!, /V4.1 Flash/);
    assert.match(h.query(".usageMetricGrid").textContent!, /Reasoning/);
  });

  test("missing totals, prices and reasoning are shown as unavailable rather than fabricated", async () => {
    const value = createUsageAggregate(false); value.count = 1; value.requests = 1;
    await popover({ usage: value });
    assert.match(h.query(".usageHero").textContent!, /Unavailable/);
    assert.ok(h.container.querySelector(".usageNotice"));
    assert.equal(h.container.querySelector(".usagePopoverModel"), null);
    assert.doesNotMatch(h.query(".usageMetricGrid").textContent!, /Cache hit|Reasoning/);
    assert.equal(h.query(".usageContextShare").textContent, "—");
  });

  test("partial prices are lower bounds and zero cache counters have no hit percentage", async () => {
    const value = usage(); value.count = 2; value.reported = 1; value.costUsd = 0.25; value.cacheHitTokens = 0; value.cacheMissTokens = 0;
    await popover({ usage: value });
    assert.match(h.query(".usageHero").textContent!, /≥ \$0\.25/);
    assert.ok(h.container.querySelector(".usageNotice"));
    assert.doesNotMatch(h.query(".usageMetricGrid").textContent!, /Cache hit/);
  });

  test("all recorded phases retain their own usage and optional cache rates", async () => {
    const value = usage();
    for (const phase of USAGE_PHASES) { recordUsage(value, phase, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 50, prompt_cache_miss_tokens: 50 }); }
    delete value.byPhase.primary!.cacheMissTokens;
    await popover({ usage: value });
    assert.equal(h.container.querySelectorAll(".usagePhaseRow").length, USAGE_PHASES.length);
    assert.equal(h.container.querySelectorAll(".usagePhaseCache").length, USAGE_PHASES.length - 1);
  });

  test("multi-model costs can be summed and unknown models remain visible", async () => {
    const total = usage(); delete total.costUsd; delete total.model; total.officialEndpoint = false;
    const first = usage(); first.costUsd = 1.25; first.count = 2;
    const second = usage(); second.model = "deepseek-custom-model"; second.costUsd = 2;
    const unknown = usage(); delete unknown.model; unknown.costUsd = 0.75;
    await popover({ usage: total, usageByModel: [first, second, unknown] });
    assert.equal(h.container.querySelectorAll(".usageModelRow").length, 3);
    assert.match(h.query(".usageHero").textContent!, /\$4\.00/);
    assert.match(h.query(".usageModels").textContent!, /custom-model.*Unknown model/i);
  });

  test("a missing model price prevents a fabricated summed total", async () => {
    const total = createUsageAggregate(false); total.count = 1;
    const unpriced = createUsageAggregate(false, "private-model"); unpriced.count = 1;
    await popover({ usage: total, usageByModel: [unpriced, usage()] });
    assert.match(h.query(".usageHero").textContent!, /Unavailable/);
  });

  test("CNY prices use the selected currency", async () => {
    const value = usage(); value.pricedAt = "2026-11-01T00:00:00.000Z";
    await popover({ usage: value, currency: "cny" });
    assert.match(h.query(".usageHero").textContent!, /¥/);
  });

  for (const result of [{ status: "compacted", freedTokens: 5000 }, { status: "compacted" }, { status: "empty" }, { status: "failed", error: "Provider unavailable" }, { status: "failed" }] as const) {
    test(`manual compaction reports ${JSON.stringify(result)} and preserves its callback`, async () => {
      let requests = 0;
      await popover({ contextWindow: context({ compactions: 2 }), compaction: { pending: false, result, onCompact: () => requests++ } });
      await h.click(".usageCompactAction"); assert.equal(requests, 1);
      const text = h.query(".usageCompactResult").textContent!; assert.ok(text.length > 0);
      if ("error" in result) { assert.match(text, /Provider unavailable/); }
      if ("freedTokens" in result) { assert.match(text, /5K/); }
      assert.match(h.query(".usageContextMeta").textContent!, /2/);
    });
  }

  const modelOptions = [{ value: "one", label: "Model one" }, { value: "two", label: "Model two" }];
  const reasoningOptions = [{ value: "off", label: "Off" }, { value: "high", label: "High" }];
  test("model and reasoning options preserve selection and emit the user's chosen value", async () => {
    const selected: string[] = [];
    await h.render(createElement(ModelReasoningPicker, { model: "one", reasoning: "high", modelOptions, reasoningOptions,
      onModelChange: (value) => selected.push(`model:${value}`), onReasoningChange: (value) => selected.push(`reasoning:${value}`) }));
    assert.match(h.query(".modelReasoningTrigger").getAttribute("aria-label")!, /Model one.*High/);
    await h.click(".modelReasoningTrigger");
    const items = h.container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
    assert.deepEqual([...items].map((item) => item.getAttribute("aria-checked")), ["false", "true", "true", "false"]);
    await h.click(items[0]!); await h.click(items[3]!);
    assert.deepEqual(selected, ["reasoning:off", "model:two"]);
    await h.key(".modelReasoningMenu", "Escape"); assert.equal(h.container.querySelector(".modelReasoningMenu"), null);
  });

  for (const pending of [false, true]) {
    test(`permission choices obey the acknowledgement lock, pending=${pending}`, async () => {
      const selected: string[] = [];
      await h.render(createElement(ModelReasoningPicker, { model: "custom", reasoning: "other", modelOptions, reasoningOptions, compact: true,
        onModelChange: () => {}, onReasoningChange: () => {}, permission: { value: "default", options: [{ value: "default", label: "Default" }, { value: "full", label: "Full access" }], pending, onChange: (value) => selected.push(value) } }));
      assert.ok(h.container.querySelector(".compactComposerPicker"));
      await h.key(".modelReasoningTrigger", "ArrowDown");
      const items = h.container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
      assert.equal(items[5]!.disabled, pending); await h.click(items[5]!);
      assert.deepEqual(selected, pending ? [] : ["full"]);
    });
  }

  test("keyboard selection wraps and Home/End target selectable options", async () => {
    await h.render(createElement(ModelReasoningPicker, { model: "one", reasoning: "high", modelOptions, reasoningOptions, onModelChange: () => {}, onReasoningChange: () => {} }));
    await h.key(".modelReasoningTrigger", "ArrowUp");
    const items = h.container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    assert.ok(h.dom.window.document.activeElement === items[1], "Opening focuses the selected reasoning option");
    await h.key(".modelReasoningMenu", "Home"); assert.ok(h.dom.window.document.activeElement === items[0]);
    await h.key(".modelReasoningMenu", "ArrowUp"); assert.ok(h.dom.window.document.activeElement === items[3]);
    await h.key(".modelReasoningMenu", "ArrowDown"); assert.ok(h.dom.window.document.activeElement === items[0]);
    await h.key(".modelReasoningMenu", "End"); assert.ok(h.dom.window.document.activeElement === items[3]);
    await h.key(".modelReasoningMenu", "Tab"); assert.ok(h.container.querySelector(".modelReasoningMenu"));
    await h.key(".modelReasoningTrigger", "ArrowDown"); assert.ok(h.container.querySelector(".modelReasoningMenu"));
  });
});

function usage(): UsageAggregate {
  const value = createUsageAggregate(true, "deepseek-flash");
  recordUsage(value, "primary", { prompt_tokens: 1000, completion_tokens: 250, total_tokens: 1250, reasoning_tokens: 100, prompt_cache_hit_tokens: 750, prompt_cache_miss_tokens: 250 });
  return value;
}
function context(patch: Partial<ContextWindowStatus> = {}): ContextWindowStatus {
  return { model: "deepseek-flash", usedTokens: 20, windowTokens: 100, softLimitTokens: 70, hardLimitTokens: 95, compactions: 0, source: "measured", ...patch };
}

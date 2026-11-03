import assert from "node:assert/strict";
import { createElement } from "react";
import ApiSection from "@webview/views/settingsView/sections/ApiSection";
import { DEFAULT_CONFIG } from "@/contracts";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("API model and reasoning controls", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let edits: Array<[string, unknown]>; let saves: Array<[string, unknown]>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); edits = []; saves = []; });
  teardown(async () => { await h.dispose(); });
  async function render(thinkingMode = true) {
    await h.render(createElement(ApiSection, { config: { ...DEFAULT_CONFIG, thinkingMode }, apiKeyDraft: "", credential: { status: "missing" },
      updateConfig: (key, value) => { edits.push([key, value]); }, saveOnBlur: (key: string | object, value?: unknown) => { saves.push([String(key), value]); },
      onApiKeyChange: () => undefined, onApiKeyBlur: () => undefined,
      modelOptions: [{ value: DEFAULT_CONFIG.model, label: "Default" }, { value: "deepseek-v4-pro", label: "Pro" }],
      reasoningEffortOptions: [{ value: "high", label: "settings.reasoning.effort" }, { value: "max", label: "settings.reasoning.effort" }] }));
  }
  test("saves only model choices offered in the selector", async () => {
    await render(); await h.input("#modelSelectSettings", "deepseek-v4-pro");
    assert.deepEqual(edits, [["model", "deepseek-v4-pro"]]); assert.deepEqual(saves, edits);
    await h.input("#modelSelectSettings", "unknown"); assert.equal(edits.length, 1); assert.equal(saves.length, 1);
  });
  test("saves thinking toggles and valid reasoning effort while ignoring missing options", async () => {
    await render(); await h.input("#reasoningEffort", "max");
    assert.deepEqual(edits, [["reasoningEffort", "max"]]); assert.deepEqual(saves, edits);
    await h.input("#reasoningEffort", "unknown"); assert.equal(edits.length, 1);
    await h.click("#thinkingModeToggle"); assert.deepEqual(edits.at(-1), ["thinkingMode", false]); assert.deepEqual(saves, edits);
    await render(false); assert.equal(h.container.querySelector("#reasoningEffort"), null);
  });
});

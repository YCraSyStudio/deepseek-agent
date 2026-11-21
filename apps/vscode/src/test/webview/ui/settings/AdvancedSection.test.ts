import assert from "node:assert/strict";
import { act, createElement } from "react";
import AdvancedSection from "@webview/views/settingsView/sections/AdvancedSection";
import { DEFAULT_CONFIG, MAX_OUTPUT_TOKENS } from "@/contracts";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("advanced settings observable edits", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let edits: Array<[string, unknown]>; let saved: Array<[string, unknown]>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); edits = []; saved = []; });
  teardown(async () => { await h.dispose(); });
  async function render(patch: Partial<typeof DEFAULT_CONFIG> = {}) {
    await h.render(createElement(AdvancedSection, { config: { ...DEFAULT_CONFIG, ...patch },
      updateConfig: (key, value) => { edits.push([key, value]); }, saveOnBlur: (key: string | object, value?: unknown) => { saved.push([String(key), value]); } }));
    if (!h.query<HTMLDetailsElement>("details").open) { await h.click("summary"); }
  }
  async function blur(selector: string) {
    await act(async () => { h.query(selector).dispatchEvent(new h.dom.window.FocusEvent("focusout", { bubbles: true })); });
  }
  for (const [baseUrl, warnings] of [
    ["https://api.deepseek.com/v1", 0], ["http://localhost:8080/v1", 2],
    ["https://provider.example/v1", 1], ["invalid origin", 1],
  ] as const) {
    test(`shows the applicable endpoint guidance for ${baseUrl}`, async () => {
      await render({ baseUrl }); assert.equal(h.container.querySelectorAll(".settingWarning").length, warnings);
    });
  }
  test("forwards endpoint edits and persists the exact value on blur", async () => {
    await render(); await h.input("#baseUrlInput", "https://next.example/v1");
    assert.deepEqual(edits, [["baseUrl", "https://next.example/v1"]]);
    await render({ baseUrl: "https://next.example/v1" }); await blur("#baseUrlInput");
    assert.deepEqual(saved, [["baseUrl", "https://next.example/v1"]]);
  });
  test("sampling controls appear only in non-thinking mode and persist numeric values", async () => {
    await render({ thinkingMode: true }); assert.equal(h.container.querySelector("#temperatureSlider"), null);
    await render({ thinkingMode: false });
    await h.input("#temperatureSlider", "1.25"); await h.input("#topPSlider", "0.75");
    assert.deepEqual(edits, [["temperature", 1.25], ["topP", 0.75]]);
    await render({ thinkingMode: false, temperature: 1.25, topP: 0.75 });
    await blur("#temperatureSlider"); await blur("#topPSlider");
    assert.deepEqual(saved, [["temperature", 1.25], ["topP", 0.75]]);
  });
  test("only forwards bounded integer output limits, on edit and blur", async () => {
    await render();
    for (const value of ["", "0", "1.5", String(MAX_OUTPUT_TOKENS + 1)]) {
      await h.input("#maxTokensInput", value);
      // Keep the controlled draft in the native input for the blur boundary.
      await act(async () => { h.query<HTMLInputElement>("#maxTokensInput").value = value; });
      await blur("#maxTokensInput");
    }
    assert.deepEqual(edits, []); assert.deepEqual(saved, []);
    for (const value of [1, MAX_OUTPUT_TOKENS]) {
      await h.input("#maxTokensInput", String(value));
      await render({ maxTokens: value }); await blur("#maxTokensInput");
    }
    assert.deepEqual(edits, [["maxTokens", 1], ["maxTokens", MAX_OUTPUT_TOKENS]]);
    assert.deepEqual(saved, edits);
  });
});

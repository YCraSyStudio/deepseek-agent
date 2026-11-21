import assert from "node:assert/strict";
import { act, createElement } from "react";
import { useChatConfig } from "@webview/views/chatView/hooks/UseChatConfig";
import { VsCodeContext } from "@webview/views/chatView/contexts/VsCodeContext";
import { getVsCodeApi } from "@webview/VsCodeApi";
import { createDomHarness } from "../../../../support/DomHarness";

suite("chat configuration action lifecycle", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let config: ReturnType<typeof useChatConfig>;
  function Fixture() { config = useChatConfig(); return null; }
  setup(async () => { h = await createDomHarness(); await h.render(createElement(VsCodeContext.Provider, { value: getVsCodeApi() }, createElement(Fixture))); });
  teardown(async () => { await h.dispose(); });
  test("maps reasoning choices to persisted configuration and updates its current reference", async () => {
    for (const [choice, effort] of [["off", undefined], ["low", "low"], ["minimal", "low"], ["medium", "high"], ["high", "high"], ["max", "max"]]) {
      await act(async () => { config.handleReasoningChange(choice!); });
      assert.equal(config.reasoning, choice); assert.equal(config.reasoningRef.current, choice);
      assert.deepEqual(h.last("saveConfig").config, choice === "off" ? { thinkingMode: false } : { thinkingMode: true, reasoningEffort: effort });
    }
  });
  test("publishes model selection and persists the same model", async () => {
    await act(async () => { config.handleModelChange("deepseek-pro"); });
    assert.equal(config.selectedModel, "deepseek-pro"); assert.equal(config.selectedModelRef.current, "deepseek-pro");
    assert.deepEqual(h.last("selectModel"), { type: "selectModel", modelId: "deepseek-pro" });
    assert.deepEqual(h.last("saveConfig").config, { model: "deepseek-pro" });
  });
  test("waits for the matching permission acknowledgement and reports host errors", async () => {
    await act(async () => { config.handlePermissionModeChange("full-access"); });
    const requestId = String(h.last("saveConfig").requestId); assert.equal(config.isPermissionUpdatePending, true);
    await act(async () => { config.applyConfigUpdateResult({ type: "configUpdateResult", requestId: "other", revision: 1, operation: "save", status: "success", config: { permissionMode: "default" } }); });
    assert.equal(config.isPermissionUpdatePending, true);
    await act(async () => { config.applyConfigUpdateResult({ type: "configUpdateResult", requestId, revision: 2, operation: "save", status: "error", config: { permissionMode: "default", thinkingMode: false } }); });
    assert.equal(config.isPermissionUpdatePending, false); assert.equal(config.permissionMode, "default");
    assert.equal(config.configUpdateError, "Failed to apply permissions."); assert.equal(config.reasoning, "off");
    await act(async () => { config.handlePermissionModeChange("full-access"); });
    assert.equal(config.configUpdateError, null);
    await act(async () => { config.applyConfigUpdateResult({ type: "configUpdateResult", requestId: String(h.last("saveConfig").requestId), revision: 3, operation: "save", status: "success", config: { permissionMode: "full-access" } }); });
    assert.equal(config.isPermissionUpdatePending, false); assert.equal(config.configUpdateError, null);
  });
  test("ignores stale configuration revisions while accepting partial updates", async () => {
    await act(async () => { config.applySavedConfig({ model: "current", historyEnabled: false, usageBreakdown: true, usageCostCurrency: "cny" }, 5); });
    await act(async () => { config.applySavedConfig({ model: "stale", historyEnabled: true }, 4); });
    assert.equal(config.selectedModel, "current"); assert.equal(config.historyEnabled, false);
    assert.equal(config.usageBreakdown, true); assert.equal(config.usageCostCurrency, "cny");
    await act(async () => { config.applySavedConfig({ reasoning: "max" }); });
    assert.equal(config.reasoning, "max"); assert.equal(config.selectedModel, "current");
  });
});

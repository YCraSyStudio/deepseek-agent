import assert from "node:assert/strict";
import { act, createElement } from "react";
import SettingsView from "@/ui/views/settingsView/SettingsView";
import { DEFAULT_CONFIG } from "@/contracts";
import { getUiLocale, setInterfaceLanguage } from "@/ui/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("mounted settings host workflows", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  const storageInfo = { directory: "/active", configuredDirectory: "/active", defaultDirectory: "/default" };
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); await h.render(createElement(SettingsView)); });
  teardown(async () => { setInterfaceLanguage("en"); await h.dispose(); });
  async function config(revision = 1, patch = {}) { await h.message({ type: "configLoaded", revision, config: { ...DEFAULT_CONFIG, ...patch }, storageInfo }); }
  async function blur(selector: string) { await act(async () => { h.query(selector).dispatchEvent(new h.dom.window.FocusEvent("focusout", { bubbles: true })); }); }
  async function result(requestId: unknown, patch = {}) { await h.message({ type: "configUpdateResult", requestId, revision: 2, operation: "save", status: "success", config: DEFAULT_CONFIG, ...patch }); }
  async function customization() { await h.click("#settings-tab-customization"); }
  function button(pattern: RegExp) { const value = [...h.container.querySelectorAll<HTMLButtonElement>("button")].find((item) => pattern.test(item.textContent ?? "")); assert.ok(value); return value; }
  test("shows initial loading, retries failed loads and keeps controls after a later save error", async () => {
    assert.match(h.query('[role="status"]').textContent!, /Loading/i);
    await result("failed", { status: "error" }); assert.ok(h.container.querySelector(".settingsError")); await h.click(".settingsError button"); assert.equal(h.posts.filter((item) => item.type === "getConfig").length, 2);
    await config(3); assert.equal(h.container.querySelector(".settingsError"), null); await result("later", { status: "error", revision: 4 });
    assert.ok(h.container.querySelector("#interfaceLanguage")); assert.ok(h.container.querySelector(".notification.error")); await h.click(".notification button"); assert.equal(h.container.querySelector(".notification"), null);
  });
  test("ignores stale configuration revisions and applies current language updates", async () => {
    await config(3, { interfaceLanguage: "es" }); assert.match(getUiLocale(), /^es/);
    await config(2, { interfaceLanguage: "zh" }); assert.match(getUiLocale(), /^es/);
    await result("stale", { revision: 1, config: { interfaceLanguage: "zh" } }); assert.match(getUiLocale(), /^es/);
    await result("current", { revision: 4, storageInfo, config: { interfaceLanguage: "en" } }); assert.match(getUiLocale(), /^en/);
    await h.input("#interfaceLanguage", "zh"); assert.deepEqual(h.last("saveConfig").config, { interfaceLanguage: "zh" }); assert.match(getUiLocale(), /^zh/);
  });
  test("all keyboard tab directions wrap, Home/End focus tabs and unrelated keys do not navigate", async () => {
    await config(); await h.key("#settings-tab-general", "ArrowLeft"); assert.equal(document.activeElement?.id, "settings-tab-customization");
    await h.key("#settings-tab-customization", "ArrowDown"); assert.equal(document.activeElement?.id, "settings-tab-general");
    await h.key("#settings-tab-general", "End"); assert.equal(document.activeElement?.id, "settings-tab-customization");
    await h.key("#settings-tab-customization", "Home"); assert.equal(document.activeElement?.id, "settings-tab-general");
    await h.key("#settings-tab-general", "ArrowRight"); await h.key("#settings-tab-api", "ArrowUp"); assert.equal(document.activeElement?.id, "settings-tab-general");
    await h.key("#settings-tab-general", "a"); assert.equal(h.query('[role="tabpanel"]').id, "settings-panel-general");
    await h.click("#settings-tab-api"); await h.click("#settings-tab-general"); assert.equal(h.query('[role="tabpanel"]').id, "settings-panel-general");
  });
  test("saves storage changes, waits for host results and exposes reload and browse actions", async () => {
    await config(); await h.input("#storageDirectory", "/new"); await blur("#storageDirectory"); assert.deepEqual(h.last("setStorageDirectory"), { type: "setStorageDirectory", directory: "/new" }); assert.ok(h.query<HTMLInputElement>("#storageDirectory").disabled);
    await h.message({ type: "storageDirectoryResult", storageInfo, error: "permission denied" }); assert.match(h.query("#storageError").textContent!, /permission denied/);
    await h.click(".storageBrowse"); assert.equal(h.last("selectStorageDirectory").type, "selectStorageDirectory");
    await h.message({ type: "storageDirectoryResult", storageInfo: { ...storageInfo, configuredDirectory: "/new" } }); assert.equal(h.container.querySelector("#storageError"), null);
    await h.click(".storageReload button"); assert.equal(h.last("reloadStorage").type, "reloadStorage");
  });
  test("workspace root selection survives refresh and falls back to preferred, first or empty roots", async () => {
    await config(); await customization(); const roots = [{ uri: "file:///a", name: "Alpha", exists: false }, { uri: "file:///b", name: "Beta", exists: true }];
    await h.message({ type: "workspaceInstructions", roots, preferredRootUri: "file:///b" }); assert.equal(h.query<HTMLSelectElement>("#workspaceInstructionsRoot").value, "file:///b");
    await h.input("#workspaceInstructionsRoot", "file:///a"); await h.message({ type: "workspaceInstructions", roots, preferredRootUri: "file:///b" }); assert.equal(h.query<HTMLSelectElement>("#workspaceInstructionsRoot").value, "file:///a");
    await h.click(button(/Generate AGENTS.md/i)); const request = h.last("openWorkspaceInstructions"); assert.equal(request.rootUri, "file:///a");
    await h.message({ type: "openWorkspaceInstructionsResult", requestId: "stale", success: false, error: "ignored" }); assert.ok(h.query<HTMLSelectElement>("#workspaceInstructionsRoot").disabled);
    await h.message({ type: "openWorkspaceInstructionsResult", requestId: request.requestId, success: true }); assert.equal(h.query<HTMLSelectElement>("#workspaceInstructionsRoot").disabled, false);
    await h.message({ type: "workspaceInstructions", roots: [{ ...roots[1] }] }); assert.ok(button(/Edit AGENTS.md/i));
    await h.message({ type: "workspaceInstructions", roots: [] }); assert.equal(h.container.querySelector("#workspaceInstructionsRoot"), null); assert.ok(button(/Generate AGENTS.md/i).disabled);
  });
  test("opening global instructions requires a matching acknowledgement and reports host errors", async () => {
    await config(1, { includeHomeAgents: true }); await customization(); await h.click(button(/Open global AGENTS.md/i)); const request = h.last("openGlobalAgents");
    assert.ok(h.query<HTMLInputElement>("#includeHomeAgents").disabled); await h.message({ type: "openGlobalAgentsResult", requestId: "old", success: true }); assert.ok(h.query<HTMLInputElement>("#includeHomeAgents").disabled);
    await h.message({ type: "openGlobalAgentsResult", requestId: request.requestId, success: false, error: "read only" }); assert.match(h.query(".notification").textContent!, /read only/); assert.equal(h.query<HTMLInputElement>("#includeHomeAgents").disabled, false);
    await h.click(button(/Open global AGENTS.md/i)); await h.message({ type: "openGlobalAgentsResult", requestId: h.last("openGlobalAgents").requestId, success: true }); assert.equal(h.query<HTMLInputElement>("#includeHomeAgents").disabled, false);
  });
  test("customization toggle remains pending until its own save result and cancellation rolls it back", async () => {
    await config(); await customization(); await h.click("#includeHomeAgents"); const request = h.last("saveConfig"); assert.deepEqual(request.config, { includeHomeAgents: !DEFAULT_CONFIG.includeHomeAgents });
    assert.ok(h.query<HTMLInputElement>("#includeHomeAgents").disabled); await result("other"); assert.ok(h.query<HTMLInputElement>("#includeHomeAgents").disabled);
    await result(request.requestId, { status: "cancelled" }); assert.equal(h.query<HTMLInputElement>("#includeHomeAgents").disabled, false); assert.equal(h.query<HTMLInputElement>("#includeHomeAgents").checked, DEFAULT_CONFIG.includeHomeAgents); assert.equal(h.container.querySelector(".notification"), null);
  });
  test("credentials remain a separate draft and clear only when the host confirms an update", async () => {
    await config(); await h.click("#settings-tab-api"); await h.message({ type: "apiKeyStatusSettings", status: "configured", keyPreview: "sk-...test" });
    await h.input("#apiKeyInput", "new-secret"); await blur("#apiKeyInput"); assert.deepEqual(h.last("saveConfig").config, { apiKey: "new-secret" });
    await result(h.last("saveConfig").requestId, { credentialUpdated: true }); assert.equal(h.query<HTMLInputElement>("#apiKeyInput").value, "");
  });
  test("tool catalog sorts returned tools, distinguishes search availability and handles empty lists", async () => {
    await config(1, { webSearchEnabled: false }); await h.click("#settings-tab-tools");
    await h.message({ type: "availableTools", tools: [{ name: "z_tool", description: "" }, { name: "search_web", description: "Search the web" }, { name: "read_web", description: "Read web pages" }] });
    await h.click("#settings-panel-tools summary");
    assert.deepEqual([...h.container.querySelectorAll(".toolCatalogList code")].map((node) => node.textContent), ["read_web", "search_web", "z_tool"]);
    assert.equal(h.container.querySelectorAll(".toolCatalogUnavailable").length, 2); assert.ok(h.container.querySelectorAll(".toolCatalogItem")[2].getAttribute("data-tooltip"));
    await h.click("#webSearchEnabled"); assert.deepEqual(h.last("saveConfig").config, { webSearchEnabled: true }); assert.equal(h.container.querySelectorAll(".toolCatalogUnavailable").length, 0);
    await h.message({ type: "availableTools", tools: [] }); assert.equal(h.container.querySelector(".toolCatalogList"), null);
  });
  test("web search country choices save uppercase custom values and empty country falls back to global", async () => {
    await config(); await h.click("#settings-tab-tools"); await h.input("#webSearchRegion", "auto"); assert.deepEqual(h.last("saveConfig").config, { webSearchRegion: "auto" });
    const before = h.posts.filter((post) => post.type === "saveConfig").length; await h.input("#webSearchRegion", "custom"); assert.equal(h.posts.filter((post) => post.type === "saveConfig").length, before);
    const selector = '#settings-panel-tools input[placeholder="ES"]'; await h.input(selector, "es"); assert.equal(h.query<HTMLInputElement>(selector).value, "ES"); await blur(selector); assert.deepEqual(h.last("saveConfig").config, { webSearchRegion: "ES" });
    await h.input(selector, ""); await blur(selector); assert.deepEqual(h.last("saveConfig").config, { webSearchRegion: "global" });
    await h.input("#capturePermission", "always"); assert.deepEqual(h.last("saveConfig").config, { capturePermission: "always" });
  });
  test("usage and privacy toggles save independently without resetting other preferences", async () => {
    await config(); await h.click("#privacyMinimizeData"); assert.deepEqual(h.last("saveConfig").config, { privacyMinimizeData: !DEFAULT_CONFIG.privacyMinimizeData });
    await h.click("#usageBreakdown"); assert.deepEqual(h.last("saveConfig").config, { usageBreakdown: !DEFAULT_CONFIG.usageBreakdown });
    await h.input("#usageCostCurrency", "cny"); assert.deepEqual(h.last("saveConfig").config, { usageCostCurrency: "cny" }); assert.equal(h.query<HTMLInputElement>("#privacyMinimizeData").checked, !DEFAULT_CONFIG.privacyMinimizeData);
  });
  test("beta feature dependencies disable suggestions and turn strict calls off when beta is disabled", async () => {
    await config(1, { betaFeaturesEnabled: true, strictToolCallsEnabled: true, editorSuggestionsEnabled: false, chatSuggestionsEnabled: false }); await h.click("#settings-tab-api");
    await h.click("#editorSuggestionsEnabled"); assert.deepEqual(h.last("saveConfig").config, { editorSuggestionsEnabled: true });
    await h.click("#chatSuggestionsEnabled"); assert.deepEqual(h.last("saveConfig").config, { chatSuggestionsEnabled: true });
    await h.click("#betaFeaturesEnabled"); const saves = h.posts.filter((post) => post.type === "saveConfig"); assert.deepEqual(saves.slice(-2).map((post) => post.config), [{ betaFeaturesEnabled: false }, { strictToolCallsEnabled: false }]);
    assert.ok(h.query<HTMLInputElement>("#editorSuggestionsEnabled").disabled); assert.ok(h.query<HTMLInputElement>("#strictToolCallsEnabled").disabled);
    await h.click("#betaFeaturesEnabled"); await h.click("#strictToolCallsEnabled"); assert.deepEqual(h.last("saveConfig").config, { strictToolCallsEnabled: true });
  });
  test("advanced endpoint and token edits are drafts until blur and display local HTTP warnings", async () => {
    await config(); await h.click("#settings-tab-api"); const before = h.posts.filter((post) => post.type === "saveConfig").length;
    await h.input("#baseUrlInput", "http://localhost:8080/v1"); assert.equal(h.posts.filter((post) => post.type === "saveConfig").length, before); assert.ok(h.container.querySelectorAll(".settingWarning").length >= 1);
    await blur("#baseUrlInput"); assert.deepEqual(h.last("saveConfig").config, { baseUrl: "http://localhost:8080/v1" });
    await h.input("#maxTokensInput", "1024"); await blur("#maxTokensInput"); assert.deepEqual(h.last("saveConfig").config, { maxTokens: 1024 });
  });

  for (const [selector, valid, invalid] of [["#historyRetentionDays", "30", "3651"], ["#maxConcurrentGenerationsInput", "4", "0"], ["#snapshotStorageLimitMb", "128", "63"]]) {
    test(`validates the bounds of ${selector} before saving`, async () => {
      await config(); const key = selector === "#maxConcurrentGenerationsInput" ? "maxConcurrentGenerations" : selector.slice(1);
      const original = Number(h.query<HTMLInputElement>(selector).value);
      await h.input(selector, invalid); await blur(selector); assert.deepEqual(h.last("saveConfig").config, { [key]: original });
      await h.input(selector, valid); await blur(selector); assert.deepEqual(h.last("saveConfig").config, { [key]: Number(valid) });
    });
  }
});

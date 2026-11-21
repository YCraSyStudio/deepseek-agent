import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, type ChangeEvent, type FocusEvent } from "react";
import type { Root } from "react-dom/client";
import { useApiConnectionState } from "@webview/views/settingsView/sections/UseApiConnectionState";

type Options = Parameters<typeof useApiConnectionState>[0];

suite("API settings React hook characterization", () => {
  let dom: JSDOM;
  let root: Root;
  let hook: ReturnType<typeof useApiConnectionState>;
  let options: Options;
  let posts: Array<Record<string, unknown>>;
  let edits: string[];
  let blurs: string[];
  let original: Map<string, PropertyDescriptor | undefined>;
  // The VS Code API is deliberately a singleton, just as it is in the webview.
  const api = { postMessage: (value: unknown) => { posts.push(value as Record<string, unknown>); }, getState: () => undefined, setState: <T,>(value: T) => value };
  function Probe() { hook = useApiConnectionState(options); return null; }
  async function render() { await act(async () => { root.render(createElement(Probe)); }); }
  async function message(value: unknown) { await act(async () => { dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: value })); }); }

  setup(async function () {
    posts = []; edits = []; blurs = []; original = new Map();
    dom = new JSDOM("<!doctype html><div id='root'></div>");
    if (this.currentTest?.title !== "works without a host API in a browser preview") {
      Object.assign(dom.window, { acquireVsCodeApi: () => api });
    }
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    options = { config: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash", thinkingMode: false, reasoningEffort: "high" },
      apiKeyDraft: "", credential: null, onApiKeyChange: (v) => edits.push(v), onApiKeyBlur: (v) => blurs.push(v) };
    const { createRoot } = await import("react-dom/client");
    root = createRoot(dom.window.document.getElementById("root")!); await render();
  });
  teardown(async () => {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) { Object.defineProperty(globalThis, key, descriptor); } else { Reflect.deleteProperty(globalThis, key); }
    }
  });

  test("works without a host API in a browser preview", async () => {
    await act(async () => { hook.handleTestConnection(); hook.handleDeleteApiKey(); });
    assert.equal(hook.isTesting, false);
    assert.equal(hook.isDeleting, false);
    assert.deepEqual(posts, []);
  });

  test("starts loading and displays the stored masked credential without exposing its value", async () => {
    assert.equal(hook.apiKeyStatus, "loading"); assert.equal(hook.apiKeyPlaceholder, "sk-...");
    options = { ...options, credential: { status: "configured", keyPreview: "abcd...wxyz" } }; await render();
    assert.equal(hook.apiKeyStatus, "configured"); assert.equal(hook.apiKeyPlaceholder, "abcd...wxyz");
    assert.equal(hook.apiKeyStatusClass, "statusConfigured");
  });

  test("reports missing credentials and treats a newly typed key as configured", async () => {
    options = { ...options, credential: { status: "missing" } }; await render();
    assert.equal(hook.apiKeyStatus, "missing"); assert.equal(hook.apiKeyStatusClass, "statusMissing"); assert.ok(hook.apiKeyMessage);
    options = { ...options, apiKeyDraft: "new-key" }; await render();
    assert.equal(hook.apiKeyStatus, "configured");
  });

  for (const success of [false, true]) {
    test(`connection testing sends the selected origin and model and settles the spinner, success=${success}`, async () => {
      options = { ...options, apiKeyDraft: "draft-key" }; await render();
      await act(async () => { hook.handleTestConnection(); });
      assert.deepEqual(posts, [{ type: "testConnection", apiKey: "draft-key", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }]);
      assert.equal(hook.isTesting, true); assert.equal(hook.apiKeyStatusClass, "statusTesting");
      await message({ type: "connectionTestResult", success });
      assert.equal(hook.isTesting, false); assert.ok(hook.apiKeyMessage);
    });
  }

  test("omits a blank draft so the host can use its stored secret", async () => {
    await act(async () => { hook.handleTestConnection(); });
    assert.equal(posts[0]!.apiKey, undefined);
    await message({ type: "connectionTestResult", success: false });
    assert.equal(hook.apiKeyStatus, "missing");
  });

  for (const status of ["success", "cancelled", "error"] as const) {
    test(`credential deletion correlates its response and restores controls, status=${status}`, async () => {
      await act(async () => { hook.handleDeleteApiKey(); });
      assert.equal(hook.isDeleting, true); assert.equal(hook.apiKeyStatus, "testing");
      const requestId = posts[0]!.requestId;
      assert.equal(typeof requestId, "string");
      await act(async () => { hook.handleDeleteApiKey(); });
      assert.equal(posts.length, 1);
      await message({ type: "apiKeyDeleteResult", requestId: "stale", status: "success" });
      assert.equal(hook.isDeleting, true);
      await message({ type: "apiKeyDeleteResult", requestId, status });
      assert.equal(hook.isDeleting, false);
      if (status === "error") { assert.ok(hook.apiKeyMessage); }
      await message({ type: "apiKeyDeleteResult", requestId, status: "error" });
      assert.equal(hook.isDeleting, false);
    });
  }

  test("ignores malformed and unrelated host messages", async () => {
    for (const value of [null, 1, "string", {}, { type: "unrelated" }]) { await message(value); }
    assert.equal(hook.isTesting, false); assert.equal(hook.isDeleting, false); assert.deepEqual(posts, []);
  });

  test("typing and blur forward the actual value and typing clears failed test feedback", async () => {
    await message({ type: "connectionTestResult", success: false });
    assert.equal(hook.apiKeyStatus, "missing");
    await act(async () => { hook.handleApiKeyChange({ target: { value: "typed-key" } } as ChangeEvent<HTMLInputElement>); });
    assert.deepEqual(edits, ["typed-key"]); assert.equal(hook.apiKeyStatus, "loading");
    await act(async () => { hook.handleApiKeyBlur({ target: { value: "blur-key" } } as FocusEvent<HTMLInputElement>); });
    assert.deepEqual(blurs, ["blur-key"]);
  });

  test("a new credential status clears old connection failure feedback", async () => {
    await message({ type: "connectionTestResult", success: false });
    assert.equal(hook.apiKeyStatus, "missing");
    options = { ...options, credential: { status: "configured", keyPreview: "masked" } }; await render();
    assert.equal(hook.apiKeyStatus, "configured"); assert.equal(hook.apiKeyMessage, null);
  });

  test("credential visibility toggles independently of its value", async () => {
    assert.equal(hook.showApiKey, false);
    await act(async () => { hook.toggleShowApiKey(); }); assert.equal(hook.showApiKey, true);
    await act(async () => { hook.toggleShowApiKey(); }); assert.equal(hook.showApiKey, false);
    assert.deepEqual(posts, []);
  });
});

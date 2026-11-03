import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG, type AppConfig, type WebviewToHandlerMessage } from "@/contracts";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import type { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { SettingsHandler } from "@/vscode/webviews/handlers/SettingsHandler";
import { dialogs } from "../../../support/VsCodeMock";

suite("settings handler characterization", () => {
  setup(() => dialogs.reset());

  for (const key of [undefined, "short", "abcd12345678wxyz"]) {
    test(`reports credential status and a masked preview for ${key ? "a " + key.length + " character key" : "a missing key"}`, async () => {
      const h = harness(); if (key) { h.keys.set(h.config.baseUrl, key); }
      await h.send({ type: "getConfig" });
      const loaded = h.last("configLoaded");
      assert.equal(loaded.revision, 1);
      assert.equal((loaded.config as AppConfig).apiKey, undefined);
      assert.deepEqual(h.last("apiKeyStatusSettings"), { type: "apiKeyStatusSettings", status: key ? "configured" : "missing",
        keyPreview: key ? key.length >= 12 ? "abcd...wxyz" : "••••" : undefined });
      assert.equal(h.last("apiKeyStatus").status, key ? "configured" : "missing");
      if (key) { assert.ok(!JSON.stringify(h.posts).includes(key)); }
    });
  }

  test("saves the trimmed credential in the secret store and excludes it from ordinary settings and responses", async () => {
    const h = harness();
    await h.send({ type: "saveConfig", requestId: "save", config: { apiKey: "  new-secret-key  ", interfaceLanguage: "es" } });
    assert.deepEqual(h.events, ["migrate:https://api.deepseek.com", "secret:https://api.deepseek.com", "save"]);
    assert.equal(h.keys.get(h.config.baseUrl), "new-secret-key");
    assert.equal(h.saved[0]!.apiKey, undefined);
    assert.equal(h.config.interfaceLanguage, "es");
    assert.equal(h.last("configUpdateResult").status, "success");
    assert.equal(h.last("configUpdateResult").credentialUpdated, true);
    assert.ok(!JSON.stringify(h.posts).includes("new-secret-key"));
  });

  test("a blank credential preserves the existing secret", async () => {
    const h = harness(); h.keys.set(h.config.baseUrl, "existing");
    await h.send({ type: "saveConfig", requestId: "save", config: { apiKey: "  " } });
    assert.equal(h.keys.get(h.config.baseUrl), "existing");
    assert.equal(h.last("configUpdateResult").credentialUpdated, false);
    assert.deepEqual(h.events, ["migrate:https://api.deepseek.com", "save"]);
  });

  for (const accepted of [false, true]) {
    test(`changing API origin requires explicit acceptance, accepted=${accepted}`, async () => {
      const h = harness(); h.keys.set(h.config.baseUrl, "old-origin-key");
      dialogs.warning = accepted ? "Change origin" : undefined;
      await h.send({ type: "saveConfig", requestId: "origin", config: { baseUrl: "https://other.example/v1/" } });
      assert.equal(h.last("configUpdateResult").status, accepted ? "success" : "cancelled");
      assert.equal(h.config.baseUrl, accepted ? "https://other.example/v1" : "https://api.deepseek.com");
      assert.equal(h.keys.get("https://api.deepseek.com"), "old-origin-key");
      assert.equal(h.keys.get("https://other.example/v1"), undefined);
      assert.equal(h.events.includes("save"), accepted);
    });
  }

  for (const accepted of [false, true]) {
    test(`full access requires explicit acceptance, accepted=${accepted}`, async () => {
      const h = harness(); dialogs.warning = accepted ? "Enable full access" : undefined;
      await h.send({ type: "saveConfig", requestId: "permissions", config: { permissionMode: "full-access" } });
      assert.equal(h.config.permissionMode, accepted ? "full-access" : DEFAULT_CONFIG.permissionMode);
      assert.equal(h.last("configUpdateResult").status, accepted ? "success" : "cancelled");
      assert.equal(h.events.includes("save"), accepted);
    });
  }

  test("saving an already enabled full-access setting does not ask again", async () => {
    const h = harness(); h.config.permissionMode = "full-access";
    await h.send({ type: "saveConfig", requestId: "same", config: { permissionMode: "full-access" } });
    assert.equal(dialogs.warnings.length, 0);
    assert.equal(h.last("configUpdateResult").status, "success");
  });

  test("reports save errors and redacts the submitted secret", async () => {
    const h = harness(); h.failure = "Cannot save top-secret-value";
    await h.send({ type: "saveConfig", requestId: "failure", config: { apiKey: "top-secret-value" } });
    assert.equal(h.last("configUpdateResult").status, "error");
    assert.ok(!JSON.stringify(h.posts).includes("top-secret-value"));
    assert.equal(h.config.apiKey, DEFAULT_CONFIG.apiKey);
  });

  for (const accepted of [false, true]) {
    test(`reset preserves API credentials and respects cancellation, accepted=${accepted}`, async () => {
      const h = harness(); h.config.interfaceLanguage = "es"; h.keys.set(h.config.baseUrl, "preserved");
      dialogs.warning = accepted ? "Reset settings" : undefined;
      await h.send({ type: "resetConfig", requestId: "reset" });
      assert.equal(h.config.interfaceLanguage, accepted ? DEFAULT_CONFIG.interfaceLanguage : "es");
      assert.equal(h.keys.get(h.config.baseUrl), "preserved");
      assert.equal(h.last("configUpdateResult").status, accepted ? "success" : "cancelled");
      assert.equal(h.events.includes("reset"), accepted);
    });
  }

  test("reports a failed reset without claiming success", async () => {
    const h = harness(); h.failure = "disk full"; dialogs.warning = "Reset settings";
    await h.send({ type: "resetConfig", requestId: "reset" });
    assert.equal(h.last("configUpdateResult").status, "error");
    assert.match(h.last("configUpdateResult").error as string, /disk full/);
  });

  for (const accepted of [false, true]) {
    test(`deletes only the active origin's credential after confirmation, accepted=${accepted}`, async () => {
      const h = harness(); h.keys.set(h.config.baseUrl, "active"); h.keys.set("https://other.example", "other");
      dialogs.warning = accepted ? "Remove credential" : undefined;
      await h.send({ type: "deleteApiKey", requestId: "delete" });
      assert.equal(h.keys.has(h.config.baseUrl), !accepted);
      assert.equal(h.keys.get("https://other.example"), "other");
      assert.equal(h.last("apiKeyDeleteResult").status, accepted ? "success" : "cancelled");
      assert.equal(h.last("apiKeyStatus").status, accepted ? "missing" : "configured");
    });
  }

  test("reports credential deletion failure and keeps its status configured", async () => {
    const h = harness(); h.keys.set(h.config.baseUrl, "active"); h.failure = "secret store unavailable"; dialogs.warning = "Remove credential";
    await h.send({ type: "deleteApiKey", requestId: "delete" });
    assert.equal(h.last("apiKeyDeleteResult").status, "error");
    assert.equal(h.last("apiKeyStatus").status, "configured");
  });

  test("connection testing never borrows another origin's credential", async () => {
    const h = harness(); h.keys.set(h.config.baseUrl, "existing");
    await h.send({ type: "testConnection", baseUrl: "https://other.example", model: "deepseek-flash" });
    assert.equal(h.last("connectionTestResult").success, false);
    assert.match(h.last("connectionTestResult").error as string, /No API key/);
    assert.equal(h.providerConfigs.length, 0);
  });

  for (const supplied of [false, true]) {
    test(`tests with the selected origin and model without persisting, replacement=${supplied}`, async () => {
      const h = harness(); h.keys.set(h.config.baseUrl, "stored-key");
      await h.send({ type: "testConnection", baseUrl: h.config.baseUrl, model: "deepseek-flash", ...(supplied ? { apiKey: " replacement-key " } : {}) });
      assert.equal(h.last("connectionTestResult").success, true);
      assert.equal(h.providerConfigs[0]!.apiKey, supplied ? "replacement-key" : "stored-key");
      assert.equal(h.providerConfigs[0]!.baseUrl, h.config.baseUrl);
      assert.equal(h.providerConfigs[0]!.model, "deepseek-flash");
      assert.equal(h.keys.get(h.config.baseUrl), "stored-key");
      assert.deepEqual(h.saved, []);
    });
  }

  for (const throws of [false, true]) {
    test(`redacts failed connection diagnostics, provider throws=${throws}`, async () => {
      const h = harness(); h.connectionFailure = "Rejected private-test-key"; h.connectionThrows = throws;
      await h.send({ type: "testConnection", baseUrl: h.config.baseUrl, model: "deepseek-flash", apiKey: "private-test-key" });
      assert.equal(h.last("connectionTestResult").success, false);
      assert.ok(!JSON.stringify(h.posts).includes("private-test-key"));
      assert.equal(h.keys.size, 0);
    });
  }
});

async function flush() { for (let i = 0; i < 8; i++) { await new Promise<void>((resolve) => setImmediate(resolve)); } }

function harness() {
  const posts: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const saved: Array<Partial<AppConfig>> = [];
  const keys = new Map<string, string>();
  const providerConfigs: AppConfig[] = [];
  const config = { ...DEFAULT_CONFIG };
  const state = { failure: "", connectionFailure: "", connectionThrows: false, revision: 1 };
  const view = { webview: { postMessage: async (p: Record<string, unknown>) => { posts.push(p); return true; } } } as unknown as vscode.WebviewView;
  const context = { globalState: { get: () => undefined } } as unknown as vscode.ExtensionContext;
  const settings = {
    load: () => config,
    getRevision: () => state.revision,
    save: async (patch: Partial<AppConfig>) => { events.push("save"); if (state.failure) { throw new Error(state.failure); } saved.push(patch); Object.assign(config, patch); state.revision++; },
    reset: async () => { events.push("reset"); if (state.failure) { throw new Error(state.failure); } Object.assign(config, DEFAULT_CONFIG); state.revision++; },
  } as SettingsRepository;
  const secrets: SecretStore = {
    getApiKey: async (url) => keys.get(url),
    setApiKey: async (url, key) => { events.push(`secret:${url}`); keys.set(url, key); },
    deleteApiKey: async (url) => { if (state.failure) { throw new Error(state.failure); } keys.delete(url); },
    migrateLegacyApiKey: async (url) => { events.push(`migrate:${url}`); },
  };
  const factory = { create: (c: AppConfig) => {
    providerConfigs.push(c);
    return { testConnection: async () => {
      if (state.connectionThrows) { throw new Error(state.connectionFailure); }
      return { success: !state.connectionFailure, error: state.connectionFailure || undefined };
    } };
  } } as unknown as ModelProviderFactory;
  const handler = new SettingsHandler(context, {} as ChatHandler, settings, secrets, factory);
  return Object.assign(state, { posts, events, saved, config, keys, providerConfigs, handler,
    async send(message: WebviewToHandlerMessage) { handler.handle(message as Parameters<SettingsHandler["handle"]>[0], view); await flush(); },
    last(type: string) { const post = [...posts].reverse().find((p) => p.type === type); assert.ok(post, `Missing ${type}`); return post; },
  });
}

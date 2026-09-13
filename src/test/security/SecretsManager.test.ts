import * as assert from "node:assert";
import type * as vscode from "vscode";
import { API_CREDENTIALS_SECRET_KEY, API_KEY_SECRET_KEY } from "@/shared/constants";
import { SecretsManager } from "@/vscode/storage/SecretsManager";

suite("origin-scoped API credentials", () => {
  test("migrates the legacy global key without losing it", async () => {
    const { context, values } = createContext({ [API_KEY_SECRET_KEY]: "sk-legacy-secret" });

    await SecretsManager.migrateLegacyApiKey(context, "https://api.deepseek.com/v1");

    assert.strictEqual(await SecretsManager.getApiKey(context, "https://api.deepseek.com"), "sk-legacy-secret");
    assert.strictEqual(values.has(API_KEY_SECRET_KEY), false);
    const stored = JSON.parse(values.get(API_CREDENTIALS_SECRET_KEY) ?? "{}") as { byOrigin?: Record<string, string> };
    assert.strictEqual(stored.byOrigin?.["https://api.deepseek.com"], "sk-legacy-secret");
  });

  test("keeps replacements isolated by parsed origin", async () => {
    const { context } = createContext();
    await SecretsManager.setApiKey(context, "https://api.deepseek.com/v1", "sk-deepseek-secret");
    await SecretsManager.setApiKey(context, "https://proxy.example.test/v1", "sk-proxy-secret");

    assert.strictEqual(await SecretsManager.getApiKey(context, "https://api.deepseek.com/other"), "sk-deepseek-secret");
    assert.strictEqual(await SecretsManager.getApiKey(context, "https://proxy.example.test/v2"), "sk-proxy-secret");
    assert.strictEqual(await SecretsManager.getApiKey(context, "https://api.deepseek.com.evil.example"), undefined);

    await SecretsManager.deleteApiKey(context, "https://proxy.example.test");
    assert.strictEqual(await SecretsManager.getApiKey(context, "https://proxy.example.test"), undefined);
    assert.strictEqual(await SecretsManager.getApiKey(context, "https://api.deepseek.com"), "sk-deepseek-secret");
  });
});

function createContext(initial: Record<string, string> = {}): {
  context: vscode.ExtensionContext;
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  const context = {
    secrets: {
      get: async (key: string) => values.get(key),
      store: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
      onDidChange: () => ({ dispose() {} }),
    },
  } as unknown as vscode.ExtensionContext;
  return { context, values };
}

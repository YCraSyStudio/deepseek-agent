import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG } from "@/contracts";
import { API_KEY_SECRET_KEY } from "@/shared/constants";
import { getSettingsFilePath } from "@/infrastructure/persistence/UserDataPaths";
import { SettingsManager } from "@/vscode/storage/SettingsManager";
import { VsCodeSecretStore, VsCodeSettingsRepository } from "@/vscode/storage/RepositoryAdapters";

suite("VS Code repository adapter lifecycle", () => {
  let root: string; let mode: string | undefined; let data: string | undefined;
  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "repository-adapters-")); mode = process.env.NODE_ENV; data = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
  });
  teardown(async () => {
    if (mode === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = mode; }
    if (data === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; } else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = data; }
    await rm(root, { recursive: true, force: true });
  });
  test("persists settings revisions and permission snapshots and exposes degraded storage state", async () => {
    await SettingsManager.initialize({ historyEnabled: true }); const repository = new VsCodeSettingsRepository();
    assert.equal(repository.getPersistenceError(), undefined); const revision = repository.getRevision();
    await repository.save({ permissionMode: "full-access", webSearchEnabled: false }); await repository.waitForPendingWrites();
    assert.equal(repository.getRevision(), revision + 1); assert.equal(repository.load().permissionMode, "full-access");
    const snapshot = await repository.capturePermissionSnapshot(false);
    assert.equal(snapshot.workspaceTrusted, false); assert.equal(snapshot.permissionMode, "default"); assert.equal(snapshot.revision, repository.getRevision());
    assert.equal((await repository.capturePermissionSnapshot(true)).permissionMode, "full-access");
    await repository.reset(); await repository.waitForPendingWrites();
    assert.equal(repository.load().permissionMode, DEFAULT_CONFIG.permissionMode);
    assert.equal(JSON.parse(await readFile(getSettingsFilePath(), "utf8")).webSearchEnabled, DEFAULT_CONFIG.webSearchEnabled);
    const stored = await readFile(getSettingsFilePath(), "utf8"); repository.enterDegradedMode(new Error("Persistence unavailable"));
    assert.equal(repository.getPersistenceError(), "Persistence unavailable"); assert.equal(repository.load().historyEnabled, false);
    await repository.save({ historyEnabled: true }); assert.equal(repository.load().historyEnabled, false);
    assert.equal(await readFile(getSettingsFilePath(), "utf8"), stored);
  });
  test("migrates credentials once and isolates replacement and deletion by API origin", async () => {
    const values = new Map<string, string>([[API_KEY_SECRET_KEY, "legacy-fixture"]]);
    const context = { secrets: { get: async (key: string) => values.get(key), store: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } } } as unknown as vscode.ExtensionContext;
    const store = new VsCodeSecretStore(context);
    await store.migrateLegacyApiKey("https://api.deepseek.com"); assert.equal(values.has(API_KEY_SECRET_KEY), false);
    assert.equal(await store.getApiKey("https://api.deepseek.com/v1"), "legacy-fixture");
    assert.equal(await store.getApiKey("https://other.example.test"), undefined);
    await store.setApiKey("https://other.example.test/v1", "other-fixture");
    assert.equal(await store.getApiKey("https://other.example.test"), "other-fixture");
    assert.equal(await store.getApiKey("https://api.deepseek.com"), "legacy-fixture");
    await store.deleteApiKey("https://api.deepseek.com");
    assert.equal(await store.getApiKey("https://api.deepseek.com"), undefined);
    assert.equal(await store.getApiKey("https://other.example.test"), "other-fixture");
  });
});

import * as assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SettingsManager } from "@/vscode/storage/SettingsManager";
import { getSettingsFilePath } from "@/infrastructure/persistence/UserDataPaths";
import { getGenerationCheckpointPath } from "@/infrastructure/persistence/UserDataPaths";
import { GenerationCheckpointStore } from "@/vscode/storage/GenerationCheckpointStore";
import { VsCodeSettingsRepository } from "@/vscode/storage/RepositoryAdapters";
import { normalizeConfig, toStoredSettings } from "@/application/settings/ConfigurationSchema";

suite("transactional settings", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousUserDataDir = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "deepseek-settings-"));

  suiteSetup(async () => {
    process.env.NODE_ENV = "test";
    process.env.DEEPSEEK_AGENT_USER_DATA_DIR = testRoot;
    await SettingsManager.initialize({ permissionMode: "auto-approve", toolExecutionModes: { read_file: "auto_approve" } });
  });

  suiteTeardown(() => {
    if (previousNodeEnv === undefined) {delete process.env.NODE_ENV;} else {process.env.NODE_ENV = previousNodeEnv;}
    if (previousUserDataDir === undefined) {delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR;} else {process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousUserDataDir;}
    rmSync(testRoot, { recursive: true, force: true });
  });

  test("keeps an authoritative resident copy instead of rereading disk", async () => {
    await SettingsManager.save({ permissionMode: "default" });
    const revision = SettingsManager.getRevision();
    const disk = JSON.parse(readFileSync(getSettingsFilePath(), "utf8")) as Record<string, unknown>;
    writeFileSync(getSettingsFilePath(), JSON.stringify({ ...disk, permissionMode: "auto-approve" }));

    assert.strictEqual(SettingsManager.load().permissionMode, "default");
    assert.strictEqual(SettingsManager.getRevision(), revision);
  });

  test("persists the web search toggle and discards retired search settings", async () => {
    assert.strictEqual(SettingsManager.load().webSearchEnabled, true);
    await SettingsManager.save({ webSearchEnabled: false });
    assert.strictEqual(SettingsManager.load().webSearchEnabled, false);
    const disk = JSON.parse(readFileSync(getSettingsFilePath(), "utf8")) as Record<string, unknown>;
    assert.strictEqual(disk.webSearchEnabled, false);
    for (const key of ["webSearchEngine", "searxngUrl", "searxngEngines", "searxngFallbackEngines", "searxngEngineCatalog"]) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(disk, key), false, key);
    }
    await SettingsManager.save({ webSearchEnabled: true });
  });

  test("persists the search-region preference without adding IP settings", async () => {
    assert.strictEqual(normalizeConfig({}).webSearchRegion, "global");
    assert.strictEqual(normalizeConfig({}).privacyMinimizeData, true);
    await SettingsManager.save({ webSearchRegion: "es" });
    assert.strictEqual(SettingsManager.load().webSearchRegion, "ES");
    const disk = JSON.parse(readFileSync(getSettingsFilePath(), "utf8")) as Record<string, unknown>;
    assert.strictEqual(disk.webSearchRegion, "ES");
    assert.strictEqual(normalizeConfig({ webSearchRegion: "global" }).webSearchRegion, "global");
    assert.strictEqual(normalizeConfig({ webSearchRegion: "1.1.1.1" }).webSearchRegion, "global");
    await SettingsManager.save({ webSearchRegion: "global", privacyMinimizeData: false });
    assert.strictEqual(SettingsManager.load().privacyMinimizeData, false);
    await SettingsManager.save({ privacyMinimizeData: true });
  });

  test("drops retired fields when loading old settings", () => {
    const retired = { syncSettingsWithVscode: true, syncGlobalAgentsWithVscode: true, webSearchEngine: "searxng", searxngUrl: "https://old.example.com",
      searxngEngines: ["g"], searxngFallbackEngines: ["ddg"], searxngEngineCatalog: [{ name: "Old" }] };
    const normalized = normalizeConfig({ ...retired, webSearchEnabled: false });
    assert.strictEqual(normalized.webSearchEnabled, false);
    for (const key of Object.keys(retired)) {
      assert.ok(!Object.hasOwn(normalized, key));
      assert.ok(!Object.hasOwn(toStoredSettings(normalized), key));
    }
  });

  test("keeps beta capabilities opt-in and persists the user's selection", async () => {
    assert.strictEqual(normalizeConfig({}).betaFeaturesEnabled, false);
    assert.strictEqual(normalizeConfig({ betaFeaturesEnabled: "true" }).betaFeaturesEnabled, false);
    await SettingsManager.save({ betaFeaturesEnabled: true });
    assert.strictEqual(SettingsManager.load().betaFeaturesEnabled, true);
    assert.strictEqual(JSON.parse(readFileSync(getSettingsFilePath(), "utf8")).betaFeaturesEnabled, true);
    await SettingsManager.save({ betaFeaturesEnabled: false });
    assert.strictEqual(SettingsManager.load().betaFeaturesEnabled, false);
  });

  test("rolls back memory and revision when persistence fails", async () => {
    const before = SettingsManager.load();
    const revision = SettingsManager.getRevision();
    rmSync(testRoot, { recursive: true, force: true });
    writeFileSync(testRoot, "blocks directory creation");

    await assert.rejects(SettingsManager.save({ permissionMode: "full-access" }));
    await assert.rejects(SettingsManager.reset());
    assert.deepStrictEqual(SettingsManager.load(), before);
    assert.strictEqual(SettingsManager.getRevision(), revision);
    assert.strictEqual(SettingsManager.isPermissionUpdatePending(), false);

    rmSync(testRoot, { force: true });
  });

  test("fails closed when capturing permissions for an untrusted workspace", async () => {
    await SettingsManager.save({ permissionMode: "auto-approve" });

    const snapshot = await SettingsManager.capturePermissionSnapshot(false);
    assert.strictEqual(snapshot.permissionMode, "default");
    assert.strictEqual(snapshot.workspaceTrusted, false);
  });

  test("holds the next permission snapshot behind a delayed durable write", async () => {
    await SettingsManager.save({ permissionMode: "auto-approve" });
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {releaseWrite = resolve;});
    SettingsManager.setPersistenceForTests(() => writeGate);

    const save = SettingsManager.save({ permissionMode: "default" });
    const capture = SettingsManager.capturePermissionSnapshot(true);
    let captured = false;
    void capture.then(() => {captured = true;});
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(SettingsManager.isPermissionUpdatePending(), true);
    assert.strictEqual(captured, false);
    assert.strictEqual(SettingsManager.load().permissionMode, "auto-approve");

    releaseWrite?.();
    await save;
    assert.strictEqual((await capture).permissionMode, "default");
    SettingsManager.setPersistenceForTests();
  });

  test("does not write checkpoints while history is disabled and clears stale files", async () => {
    const store = new GenerationCheckpointStore(new VsCodeSettingsRepository());
    const checkpoint = {
      conversationId: "incognito-conversation",
      status: "streaming" as const,
      content: "private partial response",
      timeline: [],
      toolCalls: [],
      queue: [],
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      updatedAt: Date.now(),
    };

    await SettingsManager.save({ historyEnabled: false });
    await store.save(checkpoint);
    const filePath = getGenerationCheckpointPath(checkpoint.conversationId);
    assert.strictEqual(existsSync(filePath), false);

    await SettingsManager.save({ historyEnabled: true });
    await store.save(checkpoint);
    assert.strictEqual(existsSync(filePath), true);

    await SettingsManager.save({ historyEnabled: false });
    await store.clearAll();
    assert.strictEqual(existsSync(filePath), false);
  });

  test("deletes checkpoints from unsupported schemas", async () => {
    await SettingsManager.save({ historyEnabled: true });
    const store = new GenerationCheckpointStore(new VsCodeSettingsRepository());
    await store.clearAll();
    await store.save({
      conversationId: "legacy-budget-checkpoint",
      status: "compacting",
      content: "",
      timeline: [],
      toolCalls: [],
      queue: [],
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      updatedAt: Date.now(),
    });
    const filePath = getGenerationCheckpointPath("legacy-budget-checkpoint");
    const persisted = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    writeFileSync(filePath, JSON.stringify({
      ...persisted,
      schemaVersion: 2,
      budget: { model: "legacy", effectiveMaxTokens: 1, automaticCompactions: 1, conciseRecoveries: 0 },
      conciseRecoveryUsed: false,
      compactionBoundary: { id: "legacy" },
    }));

    const recovered = await new GenerationCheckpointStore(new VsCodeSettingsRepository()).recover();
    assert.strictEqual(recovered.length, 0);
    assert.strictEqual(existsSync(filePath), false);
    await store.clearAll();
  });
});

function testWorkspaceBinding() {
  return {
    schemaVersion: 1 as const,
    uri: "file:///workspace",
    name: "workspace",
    revision: "test",
    folders: [],
    capabilities: { files: true, search: true, git: true, terminal: true },
  };
}

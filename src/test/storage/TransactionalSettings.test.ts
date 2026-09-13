import * as assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SettingsManager } from "@/vscode/storage/SettingsManager";
import { getSettingsFilePath } from "@/infrastructure/persistence/UserDataPaths";
import { getGenerationCheckpointDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { GenerationCheckpointStore } from "@/vscode/storage/GenerationCheckpointStore";
import { VsCodeSettingsRepository } from "@/vscode/storage/RepositoryAdapters";

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

  test("persists normalized web search settings with safe defaults", async () => {
    assert.strictEqual(SettingsManager.load().webSearchEngine, "searxng");
    assert.strictEqual(SettingsManager.load().webSearchEnabled, true);
    assert.strictEqual(SettingsManager.load().searxngUrl, "http://127.0.0.1:8888");
    assert.deepStrictEqual(SettingsManager.load().searxngEngines, []);
    await SettingsManager.save({ webSearchEnabled: false });
    assert.strictEqual(SettingsManager.load().webSearchEnabled, false);
    await SettingsManager.save({
      webSearchEngine: "searxng",
      searxngUrl: "https://search.example.com/",
      searxngEngines: ["g", "ddg", "g"],
    });
    assert.strictEqual(SettingsManager.load().webSearchEngine, "searxng");
    assert.strictEqual(SettingsManager.load().searxngUrl, "https://search.example.com");
    assert.deepStrictEqual(SettingsManager.load().searxngEngines, ["g", "ddg"]);
    const disk = JSON.parse(readFileSync(getSettingsFilePath(), "utf8")) as Record<string, unknown>;
    assert.strictEqual(disk.webSearchEngine, "searxng");
    assert.strictEqual(disk.searxngUrl, "https://search.example.com");
    assert.deepStrictEqual(disk.searxngEngines, ["g", "ddg"]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(disk, "webSearchBrowserVisible"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(disk, "usageBudgets"), false);
    await SettingsManager.save({ webSearchEngine: "searxng", searxngUrl: "http://127.0.0.1:8888", searxngEngines: [] });
    await SettingsManager.save({ webSearchEnabled: true });
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
    const directory = getGenerationCheckpointDirectory();
    assert.strictEqual(existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")).length : 0, 0);

    await SettingsManager.save({ historyEnabled: true });
    await store.save(checkpoint);
    assert.strictEqual(readdirSync(directory).filter((name) => name.endsWith(".json")).length, 1);

    await SettingsManager.save({ historyEnabled: false });
    await store.clearAll();
    assert.strictEqual(readdirSync(directory).filter((name) => name.endsWith(".json")).length, 0);
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
    const directory = getGenerationCheckpointDirectory();
    const filePath = path.join(directory, readdirSync(directory).find((name) => name.endsWith(".json"))!);
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

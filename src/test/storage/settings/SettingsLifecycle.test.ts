import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SettingsManager } from "@/vscode/storage/SettingsManager";
import { getSettingsFilePath } from "@/infrastructure/persistence/UserDataPaths";
import { DEFAULT_CONFIG } from "@/contracts";

suite("resident settings reset and degraded lifecycle", () => {
  let root: string; let previousMode: string | undefined; let previousDirectory: string | undefined;
  suiteSetup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "settings-lifecycle-")); previousMode = process.env.NODE_ENV; previousDirectory = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
  });
  suiteTeardown(async () => {
    SettingsManager.setPersistenceForTests();
    if (previousMode === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = previousMode; }
    if (previousDirectory === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; } else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousDirectory; }
    await rm(root, { recursive: true, force: true });
  });
  test("limits the persistence override to the test environment", () => {
    process.env.NODE_ENV = "production";
    try { assert.throws(() => SettingsManager.setPersistenceForTests(), /only available in tests/); }
    finally { process.env.NODE_ENV = "test"; }
  });
  test("initializes once, resets durably and keeps degraded settings resident without enabling history", async () => {
    assert.equal(await SettingsManager.completeMigration(), undefined);
    await SettingsManager.initialize({ historyEnabled: true, permissionMode: "default" });
    const initial = await readFile(getSettingsFilePath(), "utf8");
    await SettingsManager.initialize({ permissionMode: "full-access" });
    assert.equal(SettingsManager.load().permissionMode, "default");
    assert.equal(await readFile(getSettingsFilePath(), "utf8"), initial);
    const notices: string[] = [];
    const broken = SettingsManager.onDidChange(() => { throw new Error("observer failed"); });
    const observe = SettingsManager.onDidChange(config => { notices.push(config.permissionMode); });
    try {
      await SettingsManager.save({ permissionMode: "full-access", webSearchEnabled: false });
      const revision = SettingsManager.getRevision();
      const reset = SettingsManager.reset(); assert.equal(SettingsManager.isPermissionUpdatePending(), true);
      await reset; await SettingsManager.waitForPendingWrites();
      assert.equal(SettingsManager.isPermissionUpdatePending(), false); assert.equal(SettingsManager.getRevision(), revision + 1);
      assert.equal(SettingsManager.load().permissionMode, DEFAULT_CONFIG.permissionMode);
      assert.equal(SettingsManager.load().webSearchEnabled, DEFAULT_CONFIG.webSearchEnabled);
      assert.deepEqual(notices, ["full-access", DEFAULT_CONFIG.permissionMode]);
      assert.equal(JSON.parse(await readFile(getSettingsFilePath(), "utf8")).permissionMode, DEFAULT_CONFIG.permissionMode);
      const disk = await readFile(getSettingsFilePath(), "utf8");
      SettingsManager.enterDegradedMode(new Error("disk unavailable"));
      assert.equal(SettingsManager.getPersistenceError(), "disk unavailable"); assert.equal(SettingsManager.load().historyEnabled, false);
      const degradedRevision = SettingsManager.getRevision();
      let writes = 0; SettingsManager.setPersistenceForTests(async () => { writes++; });
      await SettingsManager.save({ historyEnabled: true, webSearchEnabled: false, apiKey: "must-not-persist", model: undefined });
      assert.equal(SettingsManager.load().historyEnabled, false); assert.equal(SettingsManager.load().webSearchEnabled, false);
      assert.equal(SettingsManager.load().apiKey, ""); assert.equal(SettingsManager.getRevision(), degradedRevision + 1);
      assert.equal(await SettingsManager.completeMigration(), undefined);
      await SettingsManager.reset();
      assert.equal(SettingsManager.load().historyEnabled, false); assert.equal(SettingsManager.load().webSearchEnabled, DEFAULT_CONFIG.webSearchEnabled);
      assert.equal(writes, 0); assert.equal(await readFile(getSettingsFilePath(), "utf8"), disk);
      SettingsManager.enterDegradedMode("plain failure"); assert.equal(SettingsManager.getPersistenceError(), "plain failure");
      const count = notices.length; observe(); broken(); await SettingsManager.save({ webSearchEnabled: false });
      assert.equal(notices.length, count);
    } finally { observe(); broken(); SettingsManager.setPersistenceForTests(); }
  });
});

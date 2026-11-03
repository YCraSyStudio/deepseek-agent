import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);

suite("settings initialization with legacy data", () => {
  let root: string;
  let legacy: string;
  let current: string;
  let entry: string;

  setup(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "deepseek-settings-startup-"));
    legacy = path.join(root, ".deepseek-agent");
    current = path.join(root, ".ycrasy-agent");
    entry = path.join(root, "initialize.mjs");
    await mkdir(legacy);
    await mkdir(current);
    await writeFile(path.join(legacy, "settings.json"), '{"historyEnabled":false,"model":"legacy"}');
    await build({
      stdin: {
        contents: `
          import { SettingsManager } from "./src/vscode/storage/SettingsManager";
          await SettingsManager.initialize({ permissionMode: "full-access", betaFeaturesEnabled: true });
          if (!SettingsManager.getPersistenceError()) {
            await SettingsManager.save({ webSearchEnabled: false });
          }
          if (SettingsManager.getPersistenceError()) {await SettingsManager.save({ webSearchEnabled: false, historyEnabled: true });}
          if (process.env.COMPLETE_MIGRATION) {await SettingsManager.completeMigration();}
          console.log(JSON.stringify({
            config: SettingsManager.load(),
            error: SettingsManager.getPersistenceError(),
          }));
        `,
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: entry,
      sourcemap: "inline",
    });
  });

  teardown(async () => {await rm(root, { recursive: true, force: true });});

  async function initialize(complete = false) {
    const result = await run(process.execPath, [entry], {
      env: { ...process.env, NODE_ENV: "production", HOME: root, USERPROFILE: root, COMPLETE_MIGRATION: complete ? "1" : "" },
    });
    return JSON.parse(result.stdout) as { config: { historyEnabled: boolean; model: string; permissionMode: string; betaFeaturesEnabled: boolean; webSearchEnabled: boolean }; error?: string };
  }

  test("keeps current settings and history writable when legacy settings conflict", async () => {
    await mkdir(path.join(current, "deepseek"));
    await mkdir(path.join(current, "history"));
    await writeFile(path.join(current, "settings.json"), '{"historyEnabled":true,"betaFeaturesEnabled":true,"privacyMinimizeData":false,"maxConcurrentGenerations":4}');
    await writeFile(path.join(current, "deepseek", "settings.json"), '{"model":"deepseek-flash"}');
    const history = path.join(current, "history", "preserved.json");
    await writeFile(history, '{"preserved":true}');

    const result = await initialize();

    assert.equal(result.error, undefined);
    assert.equal(result.config.historyEnabled, true);
    assert.equal(result.config.model, "deepseek-flash");
    assert.equal(JSON.parse(await readFile(path.join(current, "settings.json"), "utf8")).webSearchEnabled, false);
    assert.equal(await readFile(history, "utf8"), '{"preserved":true}');
    await assert.rejects(readFile(path.join(legacy, "settings.json")), { code: "ENOENT" });
    const backups = await readdir(path.join(current, "migration-backups", "legacy"));
    assert.ok(backups.some(name => name.startsWith("settings.json.")));
  });

  test("recovers valid legacy settings when current JSON is invalid and cleans backups automatically", async () => {
    await writeFile(path.join(current, "settings.json"), '{invalid');

    const result = await initialize(true);

    assert.equal(result.error, undefined);
    assert.equal(result.config.historyEnabled, false);
    await assert.rejects(readFile(path.join(legacy, "settings.json")), { code: "ENOENT" });
    await assert.rejects(readdir(path.join(current, "migration-backups")), { code: "ENOENT" });
  });

  test("keeps originals if settings still cannot load and completion is requested", async () => {
    await writeFile(path.join(legacy, "settings.json"), "invalid legacy JSON");
    await writeFile(path.join(current, "settings.json"), "invalid current JSON");
    const result = await initialize(true);
    assert.ok(result.error);
    assert.equal(result.config.historyEnabled, false);
    assert.equal(result.config.permissionMode, "default");
    assert.equal(result.config.betaFeaturesEnabled, false);
    assert.equal(result.config.webSearchEnabled, false);
    assert.ok((await readdir(path.join(current, "migration-backups", "legacy"))).length > 0);
    assert.ok((await readdir(path.join(current, "migration-backups", "current"))).length > 0);
  });

  test("migrates legacy settings when both roots already have history directories", async () => {
    await mkdir(path.join(legacy, "history"));
    await mkdir(path.join(current, "history"));

    const result = await initialize();

    assert.equal(result.error, undefined);
    assert.equal(result.config.historyEnabled, false);
    assert.equal(JSON.parse(await readFile(path.join(current, "settings.json"), "utf8")).webSearchEnabled, false);
    await assert.rejects(readFile(path.join(legacy, "settings.json")), { code: "ENOENT" });
  });
});

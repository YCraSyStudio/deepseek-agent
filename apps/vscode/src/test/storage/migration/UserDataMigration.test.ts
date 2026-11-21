import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { completeUserDataMigration, migrateUserDataDirectory, removeLegacyRuntimes } from "@/infrastructure/persistence/UserDataMigration";
import { SplitSettingsStorage } from "@/infrastructure/persistence/providers/SplitSettingsStorage";
import { writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { normalizeConfig, toStoredSettings } from "@/application/settings/ConfigurationSchema";

suite("user data root migration", () => {
  let root: string;
  let legacy: string;
  let destination: string;

  setup(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "deepseek-root-migration-"));
    legacy = path.join(root, ".deepseek-agent");
    destination = path.join(root, ".ycrasy-agent");
  });

  teardown(async () => {await rm(root, { recursive: true, force: true });});

  async function fixture(): Promise<void> {
    await mkdir(path.join(legacy, "history", "chat-1", ".screenshots"), { recursive: true });
    await mkdir(path.join(legacy, "generation-checkpoints"));
    await mkdir(path.join(legacy, "runtimes"));
    await mkdir(path.join(legacy, "runtime-state"));
    await writeFile(path.join(legacy, "settings.json"), '{"historyEnabled":true,"model":"legacy"}');
    await writeFile(path.join(legacy, "history", "chat-1", ".screenshots", "image.png"), Buffer.from([0, 1, 255, 42]));
    await writeFile(path.join(legacy, "generation-checkpoints", "chat-1.json"), '{"status":"interrupted"}');
    await writeFile(path.join(legacy, "AGENTS.md"), "User instructions");
    await mkdir(path.join(destination, "deepseek"), { recursive: true });
    await writeFile(path.join(destination, "deepseek", "settings.json"), '{"model":"current"}');
  }

  test("removes obsolete runtime directories before migration while preserving user data", async () => {
    await fixture();
    for (const directory of [legacy, destination]) {
      for (const parent of ["runtimes", "runtime-state"]) {
        await mkdir(path.join(directory, parent, "searxng", "cache"), { recursive: true });
        await writeFile(path.join(directory, parent, "searxng", "cache", "obsolete"), "legacy runtime");
      }
    }
    await removeLegacyRuntimes(legacy);
    await removeLegacyRuntimes(destination);
    await migrateUserDataDirectory(legacy, destination);
    await removeLegacyRuntimes(destination);
    assert.equal(existsSync(path.join(destination, "runtimes")), false);
    assert.equal(existsSync(path.join(destination, "runtime-state")), false);
    assert.equal(await readFile(path.join(destination, "AGENTS.md"), "utf8"), "User instructions");
    assert.equal(await readFile(path.join(destination, "deepseek", "settings.json"), "utf8"), '{"model":"current"}');
    assert.ok(existsSync(path.join(destination, "history", "chat-1", ".screenshots", "image.png")));
    assert.ok(!existsSync(legacy));
  });

  test("removes runtime symlinks without following their external targets", async () => {
    const outside = path.join(root, "outside");
    await mkdir(path.join(outside, "searxng"), { recursive: true });
    await writeFile(path.join(outside, "searxng", "keep"), "external data");
    await mkdir(path.join(destination, "runtime-state"), { recursive: true });
    await symlink(outside, path.join(destination, "runtimes"));
    await symlink(outside, path.join(destination, "runtime-state", "searxng"));
    await removeLegacyRuntimes(destination);
    assert.equal(await readFile(path.join(outside, "searxng", "keep"), "utf8"), "external data");
    assert.ok(!existsSync(path.join(destination, "runtimes")));
    assert.ok(!existsSync(path.join(destination, "runtime-state")));
    const redirected = path.join(root, "redirected");
    await symlink(outside, redirected);
    await assert.rejects(removeLegacyRuntimes(redirected), /redirected data directory/);
    assert.equal(await readFile(path.join(outside, "searxng", "keep"), "utf8"), "external data");
  });

  test("moves history, recovery, runtimes and instructions while preserving provider settings", async () => {
    await fixture();
    const historyBefore = await lstat(path.join(legacy, "history"));
    await migrateUserDataDirectory(legacy, destination);

    assert.deepEqual(await readFile(path.join(destination, "history", "chat-1", ".screenshots", "image.png")), Buffer.from([0, 1, 255, 42]));
    assert.equal(await readFile(path.join(destination, "generation-checkpoints", "chat-1.json"), "utf8"), '{"status":"interrupted"}');
    assert.equal(await readFile(path.join(destination, "AGENTS.md"), "utf8"), "User instructions");
    assert.equal(await readFile(path.join(destination, "deepseek", "settings.json"), "utf8"), '{"model":"current"}');
    assert.equal((await lstat(path.join(destination, "history"))).ino, historyBefore.ino);
    assert.ok(existsSync(path.join(destination, "runtimes")));
    assert.ok(existsSync(path.join(destination, "runtime-state")));
    assert.equal(existsSync(legacy), false);
    assert.equal((new SplitSettingsStorage(path.join(destination, "settings.json"), path.join(destination, "deepseek", "settings.json")).read() as { model: string }).model, "current");
  });

  test("removes the old directory and subsequent startups leave the new data unchanged", async () => {
    await fixture();
    await migrateUserDataDirectory(legacy, destination);
    await writeFile(path.join(destination, "runtime-state", "current-instance.json"), "updated");
    const settingsBefore = await lstat(path.join(destination, "settings.json"));
    await migrateUserDataDirectory(legacy, destination);

    assert.equal(await readFile(path.join(destination, "runtime-state", "current-instance.json"), "utf8"), "updated");
    assert.equal(existsSync(legacy), false);
    assert.equal((await lstat(path.join(destination, "settings.json"))).mtimeMs, settingsBefore.mtimeMs);
    assert.ok(!existsSync(path.join(destination, ".legacy-migration.lock")));
  });

  test("removes a previous compatibility link without deleting the migrated data", async () => {
    await fixture();
    await migrateUserDataDirectory(legacy, destination);
    await symlink(destination, legacy, process.platform === "win32" ? "junction" : "dir");
    await migrateUserDataDirectory(legacy, destination);

    assert.equal(existsSync(legacy), false);
    assert.ok(existsSync(path.join(destination, "history", "chat-1", ".screenshots", "image.png")));
    assert.equal(await readFile(path.join(destination, "deepseek", "settings.json"), "utf8"), '{"model":"current"}');
  });

  test("does not create storage on a fresh install", async () => {
    await migrateUserDataDirectory(legacy, destination);
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(legacy), false);
  });

  test("merges existing directories and settings, archives differing files and removes the old root", async () => {
    await fixture();
    await mkdir(path.join(destination, "history", "chat-2"), { recursive: true });
    await writeFile(path.join(destination, "history", "chat-2", "chat.json"), "current conversation");
    await writeFile(path.join(destination, "settings.json"), '{"historyEnabled":false}');
    await writeFile(path.join(destination, "AGENTS.md"), "Current instructions");
    await migrateUserDataDirectory(legacy, destination);

    assert.equal(existsSync(legacy), false);
    assert.ok(existsSync(path.join(destination, "history", "chat-1", ".screenshots", "image.png")));
    assert.equal(await readFile(path.join(destination, "history", "chat-2", "chat.json"), "utf8"), "current conversation");
    assert.deepEqual(JSON.parse(await readFile(path.join(destination, "settings.json"), "utf8")), { historyEnabled: true, model: "legacy" });
    assert.equal(await readFile(path.join(destination, "AGENTS.md"), "utf8"), "Current instructions");
    const backupRoot = path.join(destination, "migration-backups", "legacy");
    const backups = await readdir(backupRoot);
    const instructions = backups.find(name => name.startsWith("AGENTS.md."));
    assert.ok(instructions);
    assert.equal(await readFile(path.join(backupRoot, instructions), "utf8"), "User instructions");
    assert.ok(backups.some(name => name.startsWith("settings.json.")));
  });

  test("preserves conflicting conversation files and deduplicates identical attachments", async () => {
    await fixture();
    const chat = path.join(destination, "history", "chat-1");
    await mkdir(path.join(chat, ".screenshots"), { recursive: true });
    await writeFile(path.join(chat, ".screenshots", "image.png"), Buffer.from([0, 1, 255, 42]));
    await writeFile(path.join(legacy, "history", "chat-1", "chat.json"), "old conversation");
    await writeFile(path.join(chat, "chat.json"), "current conversation");
    await migrateUserDataDirectory(legacy, destination);

    assert.equal(existsSync(legacy), false);
    assert.equal(await readFile(path.join(chat, "chat.json"), "utf8"), "current conversation");
    assert.deepEqual(await readFile(path.join(chat, ".screenshots", "image.png")), Buffer.from([0, 1, 255, 42]));
    const backupRoot = path.join(destination, "migration-backups", "legacy", "history", "chat-1");
    const [backup] = await readdir(backupRoot);
    assert.equal(await readFile(path.join(backupRoot, backup), "utf8"), "old conversation");
  });

  test("recovers an invalid settings destination and temporarily retains originals", async () => {
    await fixture();
    await writeFile(path.join(destination, "settings.json"), "invalid");
    await migrateUserDataDirectory(legacy, destination);
    assert.equal(existsSync(legacy), false);
    assert.equal(JSON.parse(await readFile(path.join(destination, "settings.json"), "utf8")).historyEnabled, true);
    assert.ok(existsSync(path.join(destination, "migration-backups", "current")));
    assert.ok(existsSync(path.join(destination, "history", "chat-1", ".screenshots", "image.png")));
  });

  test("does not replay a legacy transaction over current settings", async () => {
    await fixture();
    await writeFile(path.join(destination, "settings.json"), '{"historyEnabled":false}');
    await writeFile(path.join(legacy, "settings.json.transaction.json"), '{"version":1,"pending":"legacy"}');
    await migrateUserDataDirectory(legacy, destination);
    assert.equal(existsSync(legacy), false);
    assert.equal(existsSync(path.join(destination, "settings.json.transaction.json")), false);
    const backups = await readdir(path.join(destination, "migration-backups", "legacy"));
    assert.ok(backups.some(name => name.startsWith("settings.json.transaction.json.")));
  });

  test("resumes after some top-level entries have already moved", async () => {
    await fixture();
    await rename(path.join(legacy, "history"), path.join(destination, "history"));
    await migrateUserDataDirectory(legacy, destination);

    assert.ok(existsSync(path.join(destination, "history", "chat-1")));
    assert.ok(existsSync(path.join(destination, "settings.json")));
    assert.equal(existsSync(legacy), false);
  });

  test("preserves an interrupted settings transaction so it can recover at the new root", async () => {
    await fixture();
    const providerFile = path.join(destination, "deepseek", "settings.json");
    const failing = new SplitSettingsStorage(path.join(legacy, "settings.json"), providerFile, async (file, value) => {
      if (file === providerFile) {throw new Error("interrupted");}
      await writeJsonFileAtomic(file, value);
    });
    await assert.rejects(failing.write(toStoredSettings(normalizeConfig({ historyEnabled: true, model: "planned" }))), /interrupted/);
    await migrateUserDataDirectory(legacy, destination);
    const recovered = new SplitSettingsStorage(path.join(destination, "settings.json"), providerFile);
    await recovered.recover();

    assert.equal((recovered.read() as { model: string }).model, "planned");
    assert.equal(existsSync(path.join(destination, "settings.json.transaction.json")), false);
  });

  test("serializes concurrent migration attempts", async () => {
    await fixture();
    await Promise.all([migrateUserDataDirectory(legacy, destination), migrateUserDataDirectory(legacy, destination)]);
    assert.equal(existsSync(legacy), false);
    assert.ok(existsSync(path.join(destination, "history", "chat-1")));
  });

  test("cleans migration backups and old review reports automatically after successful startup", async () => {
    await mkdir(path.join(destination, "migration-backups", "legacy"), { recursive: true });
    await writeFile(path.join(destination, "migration-backups", "legacy", "settings.bak"), "original");
    await writeFile(path.join(destination, "migration-backups", "review.md"), "old review");
    await writeFile(path.join(destination, "settings.json"), '{"historyEnabled":true}');
    await completeUserDataMigration(legacy, destination);
    assert.equal(existsSync(path.join(destination, "migration-backups")), false);
    assert.equal(await readFile(path.join(destination, "settings.json"), "utf8"), '{"historyEnabled":true}');
    await completeUserDataMigration(legacy, destination);
  });

  test("keeps temporary originals while any migration work is still pending", async () => {
    const backup = path.join(destination, "migration-backups", "original.bak");
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, "original");
    for (const pending of [legacy, path.join(destination, "generation-checkpoints")]) {
      await mkdir(pending);
      await completeUserDataMigration(legacy, destination);
      assert.equal(await readFile(backup, "utf8"), "original");
      await rm(pending, { recursive: true });
    }
    const journal = path.join(destination, "settings.json.transaction.json");
    await writeFile(journal, "pending transaction");
    await completeUserDataMigration(legacy, destination);
    assert.equal(await readFile(backup, "utf8"), "original");
    await rm(journal);
    await completeUserDataMigration(legacy, destination);
    assert.equal(existsSync(backup), false);
  });

  test("rejects nested roots", async () => {
    await assert.rejects(migrateUserDataDirectory(legacy, path.join(legacy, "nested")), /must not be nested/);
    await assert.rejects(migrateUserDataDirectory(path.join(destination, "nested"), destination), /must not be nested/);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SplitSettingsStorage } from "@/infrastructure/persistence/providers/SplitSettingsStorage";
import { writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { normalizeConfig, toStoredSettings } from "@/application/settings/ConfigurationSchema";
import { getProviderDataPaths } from "@/infrastructure/persistence/providers/ProviderDataPaths";
suite("Split provider storage", () => {
  let root: string; let shared: string; let provider: string;
  setup(async () => {root = await mkdtemp(path.join(tmpdir(), "split-settings-")); shared = path.join(root, "settings.json"); provider = path.join(root, "deepseek", "settings.json");});
  teardown(async () => {await rm(root, { recursive: true, force: true });});
  const stored = (value: unknown) => toStoredSettings(normalizeConfig(value));
  test("fresh install splits ownership and never persists credentials", async () => {
    const storage = new SplitSettingsStorage(shared, provider);
    await storage.write(stored({ apiKey: "secret", userId: "private", model: "chosen", historyEnabled: true }));
    const general = JSON.parse(await readFile(shared, "utf8"));
    const owned = JSON.parse(await readFile(provider, "utf8"));
    assert.equal(general.model, undefined); assert.equal(general.historyEnabled, true);
    assert.equal(owned.model, "chosen"); assert.equal(owned.apiKey, undefined); assert.equal(owned.historyEnabled, undefined);
    assert.equal((storage.read() as { model: string }).model, "chosen");
  });
  test("migrates old settings idempotently and destination fields win", async () => {
    await writeJsonFileAtomic(shared, { model: "old", temperature: 0.4, historyRetentionDays: 10 });
    await writeJsonFileAtomic(provider, { model: "new" });
    const storage = new SplitSettingsStorage(shared, provider);
    const config = storage.read(); await storage.write(stored(config)); await storage.recover();
    const before = await readFile(provider, "utf8"); await storage.write(stored(storage.read()));
    assert.equal(await readFile(provider, "utf8"), before);
    assert.equal((storage.read() as { model: string }).model, "new");
    assert.equal((storage.read() as { temperature: number }).temperature, 0.4);
  });
  test("recovers a failure between provider and shared writes", async () => {
    await writeJsonFileAtomic(shared, { model: "old", historyEnabled: true });
    const failing = new SplitSettingsStorage(shared, provider, async (file, value) => {
      if (file === shared) {throw new Error("injected shared failure");}
      await writeJsonFileAtomic(file, value);
    });
    await assert.rejects(failing.write(stored({ model: "new", historyEnabled: false })), /injected/);
    const recovered = new SplitSettingsStorage(shared, provider); await recovered.recover(); await recovered.recover();
    assert.equal((recovered.read() as { model: string }).model, "new");
    assert.equal((recovered.read() as { historyEnabled: boolean }).historyEnabled, false);
  });
  test("preserves externally changed destination after interrupted migration", async () => {
    const failing = new SplitSettingsStorage(shared, provider, async (file, value) => {if (file === provider) {throw new Error("interrupted");} await writeJsonFileAtomic(file, value);});
    await assert.rejects(failing.write(stored({ model: "planned" })));
    await mkdir(path.dirname(provider), { recursive: true }); await writeFile(provider, '{"model":"newer"}');
    await assert.rejects(new SplitSettingsStorage(shared, provider).recover(), /newer data/);
    assert.equal(JSON.parse(await readFile(provider, "utf8")).model, "newer");
  });
  test("rejects invalid namespaces and isolates provider paths during tests", () => {
    assert.throws(() => getProviderDataPaths("../outside"), /namespace/);
    const prior = process.env.NODE_ENV; const priorRoot = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
    try {assert.equal(getProviderDataPaths("deepseek").directory, path.join(root, "providers", "deepseek"));}
    finally {if (prior === undefined) {delete process.env.NODE_ENV;} else {process.env.NODE_ENV = prior;} if (priorRoot === undefined) {delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR;} else {process.env.DEEPSEEK_AGENT_USER_DATA_DIR = priorRoot;}}
  });
});

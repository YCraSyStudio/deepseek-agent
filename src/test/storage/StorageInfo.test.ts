import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type * as vscode from "vscode";
import { configureUserDataDirectory, getDefaultUserDataDirectory, getHistoryDirectory, getSettingsFilePath, resolveUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { getProviderDataPaths } from "@/infrastructure/persistence/providers/ProviderDataPaths";
import { getStorageInfo } from "@/vscode/storage/StorageInfo";
import { getConfiguredStorageDirectory, saveStorageDirectory } from "@/vscode/storage/StorageLocation";

suite("storage directory selection", () => {
  const environmentKeys = ["NODE_ENV", "DEEPSEEK_AGENT_USER_DATA_DIR", "YCRASY_AGENT_PROVIDER_DATA_DIR"] as const;
  let previous: Array<string | undefined>;
  let temporary: string;
  setup(async () => {
    previous = environmentKeys.map((key) => process.env[key]);
    process.env.NODE_ENV = "production";
    temporary = await mkdtemp(path.join(os.tmpdir(), "agent-storage-selection-"));
  });
  teardown(async () => {
    configureUserDataDirectory(undefined);
    environmentKeys.forEach((key, index) => {
      if (previous[index] === undefined) {delete process.env[key];}
      else {process.env[key] = previous[index];}
    });
    await rm(temporary, { recursive: true, force: true });
  });

  test("defaults to the host's personal directory and expands tilde", () => {
    const directory = path.join(os.homedir(), ".ycrasy-agent");
    assert.equal(getDefaultUserDataDirectory(), directory);
    assert.equal(resolveUserDataDirectory("~/.ycrasy-agent"), directory);
    assert.deepEqual(getStorageInfo(), { directory, defaultDirectory: directory, configuredDirectory: directory });
    for (const value of ["", "relative/path", "~/invalid\0path"]) {
      assert.throws(() => resolveUserDataDirectory(value));
    }
  });

  test("all persistence clients use the configured root after activation", () => {
    configureUserDataDirectory(temporary);
    assert.equal(getSettingsFilePath(), path.join(temporary, "settings.json"));
    assert.equal(getHistoryDirectory(), path.join(temporary, "history"));
    assert.equal(getProviderDataPaths("deepseek").settingsFile, path.join(temporary, "deepseek", "settings.json"));
  });

  test("saves outside the data root, waits for reload, preserves destination data and resets to default", async () => {
    const values = new Map<string, unknown>();
    const context = { globalState: {
      get: (key: string) => values.get(key),
      update: async (key: string, value: unknown) => {values.set(key, value);},
    } } as unknown as Pick<vscode.ExtensionContext, "globalState">;
    await writeFile(path.join(temporary, "history.json"), "preserve");
    await saveStorageDirectory(context, temporary);
    assert.equal(getConfiguredStorageDirectory(context), temporary);
    assert.equal(getStorageInfo(temporary).directory, getDefaultUserDataDirectory());
    assert.equal(await readFile(path.join(temporary, "history.json"), "utf8"), "preserve");
    // Do not create the real home directory in tests: validate reset via state and resolver.
    values.set("storageDirectory", undefined);
    assert.equal(getConfiguredStorageDirectory(context), getDefaultUserDataDirectory());
    const missing = path.join(temporary, "new", "folder");
    assert.equal(await saveStorageDirectory(context, missing), missing);
    await assert.rejects(saveStorageDirectory(context, path.join(temporary, "history.json")));
    assert.equal(getConfiguredStorageDirectory(context), missing);
  });
});

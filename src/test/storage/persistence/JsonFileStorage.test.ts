import * as assert from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { withFileLock, writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";

suite("JSON file storage", () => {
  test("creates parent directories and replaces an existing JSON file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deepseek-agent-"));
    const target = path.join(root, "nested", "settings.json");

    try {
      await writeJsonFileAtomic(target, { version: 1 });
      await writeJsonFileAtomic(target, { version: 2, enabled: true });

      const stored = JSON.parse(await readFile(target, "utf8")) as unknown;
      assert.deepStrictEqual(stored, { version: 2, enabled: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serializes independent callers through a shared filesystem lock", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deepseek-agent-lock-"));
    const target = path.join(root, "settings.json");
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {releaseFirst = resolve;});
    const firstStarted = new Promise<void>((resolve) => {markFirstStarted = resolve;});
    try {
      const first = withFileLock(target, async () => {
        order.push("first-start");
        markFirstStarted?.();
        await gate;
        order.push("first-end");
      });
      await firstStarted;
      const second = withFileLock(target, async () => {order.push("second");});
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepStrictEqual(order, ["first-start"]);
      releaseFirst?.();
      await Promise.all([first, second]);
      assert.deepStrictEqual(order, ["first-start", "first-end", "second"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

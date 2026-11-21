import assert from "node:assert/strict";
import { mock } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes } from "fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { withFileLock, writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { storageFaults } from "../../../support/StorageFsFaults";

suite("atomic JSON recovery under filesystem failures", () => {
  let root: string;
  let target: string;
  setup(async () => { storageFaults.length = 0; root = await mkdtemp(path.join(tmpdir(), "atomic-json-faults-")); target = path.join(root, "settings.json"); await writeJsonFileAtomic(target, { version: "original" }); });
  teardown(async () => { mock.timers.reset(); storageFaults.length = 0; await rm(root, { recursive: true, force: true }); });
  const original = () => assert.doesNotReject(async () => assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { version: "original" }));
  const replacementConflict = (code = "EPERM") => storageFaults.push({ operation: "rename", when: (from) => String(from).endsWith(".tmp"), error: failure(code) });

  for (const code of ["EPERM", "EEXIST"]) {
    test(`${code} replacement conflicts recover through an independent backup`, async () => {
      replacementConflict(code); await writeJsonFileAtomic(target, { version: "new" });
      assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { version: "new" });
      assert.deepEqual(await readdir(root), ["settings.json"]);
    });
  }
  test("a failed backup creation preserves the original file", async () => {
    replacementConflict(); storageFaults.push({ operation: "rename", when: (from) => from === target, error: failure("EACCES") });
    await assert.rejects(() => writeJsonFileAtomic(target, { version: "new" }), { code: "EACCES" }); await original();
    assert.deepEqual(await readdir(root), ["settings.json"]);
  });
  test("failure to install the replacement restores the backed-up original", async () => {
    replacementConflict(); storageFaults.push({ operation: "rename", when: (from) => String(from).endsWith(".tmp"), error: failure("EIO") });
    await assert.rejects(() => writeJsonFileAtomic(target, { version: "new" }), { code: "EIO" }); await original();
    assert.deepEqual(await readdir(root), ["settings.json"]);
  });
  test("a failed restore retains the original backup rather than silently losing it", async () => {
    replacementConflict(); storageFaults.push(
      { operation: "rename", when: (from) => String(from).endsWith(".tmp"), error: failure("EIO") },
      { operation: "rename", when: (from) => String(from).endsWith(".bak"), error: failure("EACCES") });
    await assert.rejects(() => writeJsonFileAtomic(target, { version: "new" }), { code: "EIO" });
    const files = await readdir(root); assert.equal(files.length, 1); assert.match(files[0]!, /\.bak$/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, files[0]!), "utf8")), { version: "original" });
  });
  test("failed backup cleanup rolls the write back instead of reporting success", async () => {
    replacementConflict(); storageFaults.push({ operation: "rm", when: (file) => String(file).endsWith(".bak"), error: failure("EIO") });
    await assert.rejects(() => writeJsonFileAtomic(target, { version: "new" }), { code: "EIO" }); await original();
  });
  for (const error of [null, "filesystem rejected write", new Error("unknown failure"), { code: "ENOSPC" }, { code: 13 }]) {
    test(`non-replacement failures retain the original value, error=${JSON.stringify(error)}`, async () => {
      storageFaults.push({ operation: "rename", error });
      await assert.rejects(() => writeJsonFileAtomic(target, { version: "new" }), (caught) => caught === error);
      await original(); assert.deepEqual(await readdir(root), ["settings.json"]);
    });
  }
  test("temporary cleanup failures preserve the primary write error", async () => {
    const error = failure("ENOSPC"); storageFaults.push({ operation: "writeFile", error }, { operation: "rm", error: failure("EACCES") });
    await assert.rejects(() => writeJsonFileAtomic(target, { version: "new" }), (caught) => caught === error); await original();
  });
  test("unserializable values leave no temporary file and preserve the existing JSON", async () => {
    const value: { cycle?: unknown } = {}; value.cycle = value;
    await assert.rejects(() => writeJsonFileAtomic(target, value), /circular/i); await original(); assert.deepEqual(await readdir(root), ["settings.json"]);
  });
  test("expired filesystem locks can be reclaimed before running the operation", async () => {
    const lock = `${target}.lock`; await mkdir(lock); const old = new Date(Date.now() - 31_000); await utimes(lock, old, old);
    const result = await withFileLock(target, async () => "completed"); assert.equal(result, "completed");
    await assert.rejects(() => stat(lock), { code: "ENOENT" });
  });
  test("an operation failure still releases its lock for the next writer", async () => {
    const error = new Error("operation failed"); await assert.rejects(() => withFileLock(target, async () => { throw error; }), (caught) => caught === error);
    assert.equal(await withFileLock(target, async () => "next writer"), "next writer");
  });
  test("lock cleanup errors do not turn a completed operation into a false failure", async () => {
    storageFaults.push({ operation: "rm", when: (file) => String(file).endsWith(".lock"), error: failure("EACCES") });
    assert.equal(await withFileLock(target, async () => "committed"), "committed"); assert.equal((await stat(`${target}.lock`)).isDirectory(), true);
  });
  for (const error of [undefined, null, "locked filesystem", {}, { code: "EACCES" }]) {
    test(`lock acquisition rejects non-contention failures, error=${JSON.stringify(error)}`, async () => {
      storageFaults.push({ operation: "mkdir", when: (file) => String(file).endsWith(".lock"), error });
      let ran = false;
      await assert.rejects(() => withFileLock(target, async () => { ran = true; }), (caught) => caught === error); assert.equal(ran, false);
    });
  }
  for (const unavailableMetadata of [false, true]) {
    test(`fresh locks time out without running or removing another writer's operation, stat unavailable=${unavailableMetadata}`, async () => {
      await mkdir(`${target}.lock`);
      if (unavailableMetadata) { storageFaults.push({ operation: "stat", error: failure("EIO") }); }
      mock.timers.enable({ apis: ["Date"], now: Date.now() });
      let ran = false; const operation = withFileLock(target, async () => { ran = true; });
      mock.timers.tick(10_001);
      await assert.rejects(operation, /Timed out waiting for storage lock: settings.json/); assert.equal(ran, false);
      assert.equal((await stat(`${target}.lock`)).isDirectory(), true);
    });
  }
});
function failure(code: string) { return Object.assign(new Error(`Filesystem ${code}`), { code }); }

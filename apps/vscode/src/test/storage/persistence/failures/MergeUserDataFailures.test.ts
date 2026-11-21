import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mergeLegacyData } from "@/infrastructure/persistence/MergeUserData";
import { storageFaults } from "../../../support/StorageFsFaults";

suite("legacy data migration filesystem recovery", () => {
  let root: string; let legacy: string; let destination: string;
  const failure = (code: string) => Object.assign(new Error(code), { code });
  setup(async () => {
    storageFaults.length = 0; root = await mkdtemp(path.join(tmpdir(), "migration-faults-"));
    legacy = path.join(root, "legacy"); destination = path.join(root, "destination");
    await mkdir(legacy); await mkdir(destination);
  });
  teardown(async () => { storageFaults.length = 0; await rm(root, { recursive: true, force: true }); });
  for (const [old, current, expected] of [
    ['{"valid":true}', '{broken', '{"valid":true}'],
    ['bad', '{also invalid but longer', '{also invalid but longer'],
  ]) {
    test(`retains the best available conflicting JSON content, legacy=${old}`, async () => {
      await writeFile(path.join(legacy, "value.json"), old!); await writeFile(path.join(destination, "value.json"), current!);
      await mergeLegacyData(legacy, destination);
      assert.equal(await readFile(path.join(destination, "value.json"), "utf8"), expected);
      assert.deepEqual(await readdir(legacy), []);
      assert.equal((await readdir(path.join(destination, "migration-backups/legacy"))).length, 1);
      assert.equal((await readdir(path.join(destination, "migration-backups/current"))).length, 1);
    });
  }
  test("refuses a destination symlink without changing the file it points to", async () => {
    await writeFile(path.join(root, "outside"), "Unrelated data");
    await writeFile(path.join(legacy, "value.txt"), "legacy");
    await symlink(path.join(root, "outside"), path.join(destination, "value.txt"));
    await assert.rejects(mergeLegacyData(legacy, destination), /redirected legacy data migration/);
    assert.equal(await readFile(path.join(root, "outside"), "utf8"), "Unrelated data");
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "legacy");
  });
  test("refuses file/directory collisions without removing either side", async () => {
    await writeFile(path.join(legacy, "value"), "legacy"); await mkdir(path.join(destination, "value"));
    await assert.rejects(mergeLegacyData(legacy, destination), /Conflicting data entry types/);
    assert.equal(await readFile(path.join(legacy, "value"), "utf8"), "legacy");
    assert.deepEqual(await readdir(path.join(destination, "value")), []);
  });
  test("refuses redirected backup directories before writing outside the destination", async () => {
    await writeFile(path.join(legacy, "value.txt"), "legacy"); await writeFile(path.join(destination, "value.txt"), "current");
    const outside = path.join(root, "outside"); await mkdir(outside);
    await symlink(outside, path.join(destination, "migration-backups"), "dir");
    await assert.rejects(mergeLegacyData(legacy, destination), /redirected migration backup/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "legacy");
    assert.equal(await readFile(path.join(destination, "value.txt"), "utf8"), "current");
  });
  test("propagates backup directory creation failures and retains both originals", async () => {
    await writeFile(path.join(legacy, "value.txt"), "legacy"); await writeFile(path.join(destination, "value.txt"), "current");
    storageFaults.push({ operation: "mkdir", error: failure("EACCES") });
    await assert.rejects(mergeLegacyData(legacy, destination), { code: "EACCES" });
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "legacy");
    assert.equal(await readFile(path.join(destination, "value.txt"), "utf8"), "current");
  });
  for (const nested of [false, true]) {
    test(`moves legacy content through a real copy after cross-device rename, nested=${nested}`, async () => {
      if (nested) { await mkdir(path.join(legacy, "folder")); }
      const relative = nested ? "folder/value.txt" : "value.txt";
      await writeFile(path.join(legacy, relative), "Legacy content");
      storageFaults.push({ operation: "rename", when: from => String(from).startsWith(legacy), error: failure("EXDEV") });
      if (nested) { storageFaults.push({ operation: "rename", when: from => String(from).startsWith(legacy), error: failure("EXDEV") }); }
      await mergeLegacyData(legacy, destination);
      assert.equal(await readFile(path.join(destination, relative), "utf8"), "Legacy content");
      assert.deepEqual(await readdir(legacy), []); assert.equal(storageFaults.length, 0);
    });
  }
  test("preserves legacy files when rename fails for a reason other than a device boundary", async () => {
    await writeFile(path.join(legacy, "value.txt"), "Legacy content");
    storageFaults.push({ operation: "rename", error: failure("EACCES") });
    await assert.rejects(mergeLegacyData(legacy, destination), { code: "EACCES" });
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "Legacy content");
    assert.deepEqual(await readdir(destination), []);
  });
  test("does not delete a source when the cross-device copy fails", async () => {
    await writeFile(path.join(legacy, "value.txt"), "Legacy content");
    storageFaults.push({ operation: "rename", error: failure("EXDEV") }, { operation: "copyFile", error: failure("ENOSPC") });
    await assert.rejects(mergeLegacyData(legacy, destination), { code: "ENOSPC" });
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "Legacy content");
    assert.deepEqual(await readdir(destination), []);
  });
  test("propagates destination inspection failures instead of treating inaccessible files as absent", async () => {
    await writeFile(path.join(legacy, "value.txt"), "Legacy content");
    storageFaults.push({ operation: "lstat", when: file => file === path.join(destination, "value.txt"), error: failure("EACCES") });
    await assert.rejects(mergeLegacyData(legacy, destination), { code: "EACCES" });
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "Legacy content");
  });
  for (const archived of ["same content", "tampered content"]) {
    test(`verifies an already existing content-addressed backup: ${archived}`, async () => {
      await writeFile(path.join(legacy, "value.txt"), "same content");
      await writeFile(path.join(destination, "value.txt"), "current");
      const hash = createHash("sha256").update("same content").digest("hex");
      const directory = path.join(destination, "migration-backups/legacy"); await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `value.txt.${hash}.bak`), archived);
      if (archived === "same content") {
        await mergeLegacyData(legacy, destination);
        assert.equal(await readFile(path.join(destination, "value.txt"), "utf8"), "same content");
        assert.deepEqual(await readdir(legacy), []);
      } else {
        await assert.rejects(mergeLegacyData(legacy, destination), /backup verification failed/);
        assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "same content");
        assert.equal(await readFile(path.join(destination, "value.txt"), "utf8"), "current");
      }
    });
  }
  test("propagates backup copy failures while preserving both conflicting originals", async () => {
    await writeFile(path.join(legacy, "value.txt"), "legacy"); await writeFile(path.join(destination, "value.txt"), "current");
    storageFaults.push({ operation: "copyFile", error: failure("EIO") });
    await assert.rejects(mergeLegacyData(legacy, destination), { code: "EIO" });
    assert.equal(await readFile(path.join(legacy, "value.txt"), "utf8"), "legacy");
    assert.equal(await readFile(path.join(destination, "value.txt"), "utf8"), "current");
  });
});

import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { WorkspaceRestoreStore } from "@/infrastructure/workspace/WorkspaceRestoreStore";
import { captureWorkspaceSnapshot, workspaceChangeNotice, type SnapshotRoot } from "@/infrastructure/workspace/WorkspaceSnapshot";
import { assertSnapshotCapacity } from "@/infrastructure/workspace/SnapshotCapacity";

suite("recoverable workspace copies", () => {
  let temporary: string;
  let workspace: string;
  let data: string;
  let roots: SnapshotRoot[];
  let store: WorkspaceRestoreStore;
  let snapshot: string;
  setup(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "deepseek-recovery-"));
    workspace = path.join(temporary, "project");
    data = path.join(temporary, "data");
    await mkdir(workspace);
    await mkdir(path.join(data, "history", "chat-1"), { recursive: true });
    await writeFile(path.join(data, "history", "chat-1", "manifest.json"), "{}");
    roots = [{ alias: "project", uri: `file://${workspace}`, localPath: workspace }];
    store = new WorkspaceRestoreStore("chat-1", data);
    snapshot = path.join(data, "snapshoots", "chat-1");
  });
  teardown(async () => {await rm(temporary, { recursive: true, force: true });});
  const begin = async (id = "turn-1") => store.begin(id, roots, new Map());
  const finish = async (id = "turn-1") => store.finish(id, roots, new Map());
  test("rejects duplicate and unsafe turn identifiers without overwriting an existing recovery copy", async () => {
    await writeFile(path.join(workspace, "file.txt"), "Before"); await begin();
    await writeFile(path.join(workspace, "file.txt"), "Current");
    await assert.rejects(begin(), /already exists for this turn/);
    assert.equal(await readFile(path.join(snapshot, ".snapshot/turns/turn-1/before/file.txt"), "utf8"), "Before");
    for (const id of ["", "../escape", "a".repeat(201)]) { await assert.rejects(begin(id), /Invalid recovery turn id/); }
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "Current");
  });
  test("refuses unfinished turns and ignores unrelated entries when selecting the latest completed change", async () => {
    await writeFile(path.join(workspace, "file.txt"), "Before"); await begin();
    await assert.rejects(store.review(roots, "turn-1"), /not finished capturing/);
    await assert.rejects(store.revert(roots, "turn-1"), /no completed recovery snapshot/);
    await assert.rejects(store.diff(roots, "turn-1", "project/file.txt"), /No saved change/);
    await writeFile(path.join(snapshot, ".snapshot/turns/ignored"), "Unrelated");
    await assert.rejects(store.review(roots), /No completed changes/);
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "Before");
  });
  for (const invalid of ["directory", "oversized"] as const) {
    test(`rejects a ${invalid} recovery manifest before applying changes`, async () => {
      await writeFile(path.join(workspace, "file.txt"), "Before"); await begin();
      const manifest = path.join(snapshot, ".snapshot/turns/turn-1/turn.json"); await rm(manifest);
      if (invalid === "directory") { await mkdir(manifest); } else { await writeFile(manifest, ""); await truncate(manifest, 64 * 1024 * 1024 + 1); }
      await assert.rejects(store.review(roots, "turn-1"), /Invalid recovery manifest/);
      assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "Before");
    });
  }
  test("shows empty diff sides for newly created or deleted files and rejects unchanged paths", async () => {
    await writeFile(path.join(workspace, "deleted.txt"), "Deleted content"); await writeFile(path.join(workspace, "unchanged.txt"), "Same"); await begin();
    await rm(path.join(workspace, "deleted.txt")); await writeFile(path.join(workspace, "created.txt"), "Created content"); await finish();
    assert.deepEqual(await store.diff(roots, "turn-1", "project/deleted.txt"), { before: "Deleted content", after: "" });
    assert.deepEqual(await store.diff(roots, "turn-1", "project/created.txt"), { before: "", after: "Created content" });
    await assert.rejects(store.diff(roots, "turn-1", "project/unchanged.txt"), /No saved change/);
  });
  test("refuses a changed review copy without modifying the current workspace", async () => {
    await writeFile(path.join(workspace, "file.txt"), "Before"); await begin(); await writeFile(path.join(workspace, "file.txt"), "After"); await finish();
    await writeFile(path.join(snapshot, ".snapshot/turns/turn-1/before/file.txt"), "Tampered");
    await assert.rejects(store.diff(roots, "turn-1", "project/file.txt"), /recovery copy is missing or has changed/);
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "After");
  });
  for (const large of [false, true]) {
    test(`retains recovery while refusing unsupported text review, oversized=${large}`, async () => {
      const before = large ? Buffer.alloc(2 * 1024 * 1024 + 1, 65) : Buffer.from([0, 1, 255]);
      await writeFile(path.join(workspace, "file.bin"), before); await begin(); await writeFile(path.join(workspace, "file.bin"), "After"); await finish();
      await assert.rejects(store.diff(roots, "turn-1", "project/file.bin"), /binary or too large for a text review/);
      await store.revert(roots, "turn-1"); assert.deepEqual(await readFile(path.join(workspace, "file.bin")), before);
    });
  }
  test("reviews and restores symbolic link targets without reading or replacing their destination files", async () => {
    await writeFile(path.join(workspace, "first.txt"), "First"); await writeFile(path.join(workspace, "second.txt"), "Second");
    const link = path.join(workspace, "link.txt"); await symlink("first.txt", link); await begin();
    await rm(link); await symlink("second.txt", link); await finish();
    assert.deepEqual(await store.diff(roots, "turn-1", "project/link.txt"), { before: "Symlink: first.txt", after: "Symlink: second.txt" });
    await store.revert(roots, "turn-1"); assert.equal(await readlink(link), "first.txt");
    assert.equal(await readFile(path.join(workspace, "first.txt"), "utf8"), "First"); assert.equal(await readFile(path.join(workspace, "second.txt"), "utf8"), "Second");
  });
  test("does not overwrite a directory that replaced a changed file", async () => {
    const file = path.join(workspace, "file.txt"); await writeFile(file, "Before"); await begin(); await writeFile(file, "After"); await finish();
    await rm(file); await mkdir(file);
    await assert.rejects(store.revert(roots, "turn-1"), /Cannot restore over a directory/);
    assert.equal((await lstat(file)).isDirectory(), true);
  });
  test("detects writes made between restoration preflight and applying a file", async () => {
    const file = path.join(workspace, "file.txt"); await writeFile(file, "Before"); await begin(); await writeFile(file, "After"); await finish();
    await assert.rejects(store.revert(roots, "turn-1", () => { writeFileSync(file, "Concurrent user edit"); }), /changed during restoration/);
    assert.equal(await readFile(file, "utf8"), "Concurrent user edit"); assert.equal((await store.review(roots, "turn-1")).reverted, false);
  });

  test("replaces the live mirror after rebinding to a different root while retaining old turn copies", async () => {
    await writeFile(path.join(workspace, "old.txt"), "Original root"); await begin();
    await writeFile(path.join(workspace, "old.txt"), "Changed root"); await finish();
    const next = path.join(temporary, "next-project"); await mkdir(next); await writeFile(path.join(next, "new.txt"), "New root");
    const nextRoots = [{ alias: "next", uri: `file://${next}`, localPath: next }];
    await store.begin("turn-2", nextRoots, new Map());
    await assert.rejects(readFile(path.join(snapshot, "old.txt")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(snapshot, "new.txt"), "utf8"), "New root");
    assert.equal(await readFile(path.join(snapshot, ".snapshot/turns/turn-1/before/old.txt"), "utf8"), "Original root");
    assert.equal((await store.review(roots, "turn-1")).reverted, false);
  });
  test("rolls already restored files forward when a later restoration is rejected", async () => {
    for (const name of ["a.txt", "b.txt"]) { await writeFile(path.join(workspace, name), `before ${name}`); }
    await begin();
    for (const name of ["a.txt", "b.txt"]) { await writeFile(path.join(workspace, name), `after ${name}`); }
    await finish(); let restoredFirst = false;
    await assert.rejects(store.revert(roots, "turn-1", paths => {
      if (paths.length !== 1) { return; }
      if (path.basename(paths[0]) === "a.txt") { restoredFirst = true; }
      if (path.basename(paths[0]) === "b.txt") { throw new Error("Second file became read-only"); }
    }), /Second file became read-only/);
    assert.equal(restoredFirst, true);
    for (const name of ["a.txt", "b.txt"]) { assert.equal(await readFile(path.join(workspace, name), "utf8"), `after ${name}`); }
    assert.equal((await store.review(roots, "turn-1")).reverted, false);
  });

  test("keeps actual independent source copies directly in the chat directory", async () => {
    await writeFile(path.join(workspace, "auth.ts"), "pre-existing user edits");
    await begin();
    assert.equal(await readFile(path.join(snapshot, "auth.ts"), "utf8"), "pre-existing user edits");
    assert.ok(!((await readdir(snapshot)).includes("workspace")));
    await writeFile(path.join(workspace, "auth.ts"), "agent change");
    await finish();
    assert.equal(await readFile(path.join(snapshot, "auth.ts"), "utf8"), "agent change");
    const backup = path.join(snapshot, ".snapshot", "turns", "turn-1", "before", "auth.ts");
    assert.equal(await readFile(backup, "utf8"), "pre-existing user edits");
    assert.notEqual((await lstat(backup)).ino, (await lstat(path.join(workspace, "auth.ts"))).ino);
    await store.revert(roots, "turn-1");
    assert.equal(await readFile(path.join(workspace, "auth.ts"), "utf8"), "pre-existing user edits");
  });

  test("recovers the pre-tool unsaved buffer from independent copies after reopening the store", async () => {
    const file = path.join(workspace, "open-buffer.txt");
    const before = "unsaved user text\n";
    const after = "unsaved user text plus tool change\n";
    await writeFile(file, "saved\n");
    await store.begin("turn-1", roots, new Map([[file, before]]));
    await store.finish("turn-1", roots, new Map([[file, after]]));
    assert.equal(await readFile(file, "utf8"), "saved\n", "capturing dirty buffers must not save them");
    assert.equal(await readFile(path.join(snapshot, ".snapshot", "turns", "turn-1", "before", "open-buffer.txt"), "utf8"), before);

    const reopened = new WorkspaceRestoreStore("chat-1", data);
    assert.deepEqual(await reopened.diff(roots, "turn-1", "project/open-buffer.txt"), { before, after });
    // Once the user saves the tool result, recovery must restore the dirty
    // pre-tool version rather than the older contents originally on disk.
    await writeFile(file, after);
    await reopened.revert(roots, "turn-1");
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal((await reopened.review(roots, "turn-1")).reverted, true);
  });

  test("restores modified, deleted and binary files and removes newly created paths", async () => {
    await writeFile(path.join(workspace, "edit.txt"), "before");
    await writeFile(path.join(workspace, "deleted.txt"), "restore me");
    await writeFile(path.join(workspace, "binary.bin"), Buffer.from([0, 1, 255]));
    await begin();
    await writeFile(path.join(workspace, "edit.txt"), "after");
    await rm(path.join(workspace, "deleted.txt"));
    await writeFile(path.join(workspace, "binary.bin"), Buffer.from([0, 2, 255]));
    await mkdir(path.join(workspace, "new-directory"));
    await writeFile(path.join(workspace, "new-directory", "new.txt"), "new");
    await finish();
    const result = await store.revert(roots);
    assert.equal(result.paths.length, 4);
    assert.equal(await readFile(path.join(workspace, "edit.txt"), "utf8"), "before");
    assert.equal(await readFile(path.join(workspace, "deleted.txt"), "utf8"), "restore me");
    assert.deepEqual(await readFile(path.join(workspace, "binary.bin")), Buffer.from([0, 1, 255]));
    await assert.rejects(() => lstat(path.join(workspace, "new-directory")), { code: "ENOENT" });
    assert.equal((await store.review(roots, "turn-1")).reverted, true);
  });

  test("preflights every file and preserves subsequent user edits without partially reverting", async () => {
    await writeFile(path.join(workspace, "a.txt"), "before-a");
    await writeFile(path.join(workspace, "z.txt"), "before-z");
    await begin();
    await writeFile(path.join(workspace, "a.txt"), "after-a");
    await writeFile(path.join(workspace, "z.txt"), "after-z");
    await finish();
    await writeFile(path.join(workspace, "z.txt"), "later user edit");
    await assert.rejects(() => store.revert(roots), /changed since this turn/);
    assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "after-a");
    assert.equal(await readFile(path.join(workspace, "z.txt"), "utf8"), "later user edit");
  });

  test("provides full before/after review documents and rejects tampered recovery copies", async () => {
    await writeFile(path.join(workspace, "file.txt"), "before\n");
    await begin();
    await writeFile(path.join(workspace, "file.txt"), "after\n");
    await finish();
    assert.deepEqual(await store.diff(roots, "turn-1", "project/file.txt"), { before: "before\n", after: "after\n" });
    await writeFile(path.join(snapshot, ".snapshot", "turns", "turn-1", "before", "file.txt"), "tampered");
    await assert.rejects(() => store.revert(roots), /missing or corrupt/);
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "after\n");
  });

  test("makes reverting idempotent and keeps earlier turn backups", async () => {
    await writeFile(path.join(workspace, "file.txt"), "before");
    await begin();
    await writeFile(path.join(workspace, "file.txt"), "first result");
    await finish();
    await begin("turn-2");
    await writeFile(path.join(workspace, "file.txt"), "second result");
    await finish("turn-2");
    assert.equal((await store.revert(roots)).generationId, "turn-2");
    await store.revert(roots, "turn-2");
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "first result");
    await store.revert(roots, "turn-1");
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "before");
  });

  test("unchanged turns keep no historic copies and agent edits do not trigger the next reminder", async () => {
    await writeFile(path.join(workspace, "file.txt"), "before");
    await begin();
    await writeFile(path.join(workspace, "file.txt"), "after");
    await finish();
    const second = await begin("turn-2");
    assert.equal(workspaceChangeNotice(second.previous, second.current), "");
    await finish("turn-2");
    await assert.rejects(() => store.review(roots, "turn-2"), { code: "ENOENT" });
    assert.deepEqual(await readdir(path.join(snapshot, ".snapshot", "turns")), ["turn-1"]);
  });

  test("never crosses into a rebound workspace or traverses replaced parent symlinks", async () => {
    await mkdir(path.join(workspace, "src"));
    await writeFile(path.join(workspace, "src", "file.txt"), "before");
    await begin();
    await writeFile(path.join(workspace, "src", "file.txt"), "after");
    await finish();
    await assert.rejects(() => store.revert([{ ...roots[0], uri: "file:///other" }]), /different workspace/);
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "file.txt"), "after");
    await rm(path.join(workspace, "src"), { recursive: true });
    await symlink(outside, path.join(workspace, "src"));
    await assert.rejects(() => store.revert(roots), /symlinks/);
    assert.equal(await readFile(path.join(outside, "file.txt"), "utf8"), "after");
  });

  test("aborts before writes when editors or another generation cannot be safely restored", async () => {
    await writeFile(path.join(workspace, "file.txt"), "before");
    await begin();
    await writeFile(path.join(workspace, "file.txt"), "after");
    await finish();
    await assert.rejects(() => store.revert(roots, undefined, () => {throw new Error("Unsaved editor changes");}), /Unsaved/);
    assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "after");
  });

  test("mirrors multiple roots under their aliases without a workspace directory", async () => {
    const second = path.join(temporary, "second");
    await mkdir(second);
    await writeFile(path.join(workspace, "same.txt"), "one");
    await writeFile(path.join(second, "same.txt"), "two");
    roots.push({ alias: "second", uri: `file://${second}`, localPath: second });
    await begin();
    assert.equal(await readFile(path.join(snapshot, "project", "same.txt"), "utf8"), "one");
    assert.equal(await readFile(path.join(snapshot, "second", "same.txt"), "utf8"), "two");
  });

  test("excludes generated web and .NET artifacts while retaining source bin directories", async () => {
    await writeFile(path.join(workspace, "package.json"), "{}");
    for (const directory of ["node_modules", "dist", "api/bin", "api/obj", "scripts/bin"]) {
      await mkdir(path.join(workspace, directory), { recursive: true });
      await writeFile(path.join(workspace, directory, "file.txt"), "contents");
    }
    await writeFile(path.join(workspace, "api", "app.csproj"), "<Project />");
    const captured = await captureWorkspaceSnapshot(roots);
    assert.ok(Object.hasOwn(captured.files, "project/scripts/bin/file.txt"));
    assert.ok(Object.hasOwn(captured.files, "project/api/app.csproj"));
    for (const name of ["node_modules", "dist", "api/bin", "api/obj"]) {
      assert.ok(!Object.keys(captured.files).some((label) => label.startsWith(`project/${name}/`)));
    }
  });

  test("checks the shared storage quota and free disk reserve before copying", async () => {
    await mkdir(path.join(data, "snapshoots"));
    await assert.rejects(() => assertSnapshotCapacity(data, 1, 1024 * 1024, 1e12), /storage limit/);
    await assert.rejects(() => assertSnapshotCapacity(data, 1024, 1024, 1024), /free disk space/);
    await assertSnapshotCapacity(data, 1024, 1024, 1e12);
  });

  test("failed capture keeps existing backups and cleans incomplete staging", async () => {
    await writeFile(path.join(workspace, "file.txt"), "before");
    await begin();
    await writeFile(path.join(workspace, "file.txt"), "after");
    await finish();
    const limited = new WorkspaceRestoreStore("chat-1", data, 0);
    await assert.rejects(() => limited.begin("turn-2", roots, new Map()), /storage limit/);
    assert.ok((await store.review(roots, "turn-1")).paths.length);
    assert.ok(!(await readdir(path.join(data, "snapshoots"))).some((name) => name.startsWith(".pending-")));
  });
});

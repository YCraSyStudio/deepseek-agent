import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

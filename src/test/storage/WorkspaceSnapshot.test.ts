import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { captureWorkspaceSnapshot, workspaceChangeNotice, WorkspaceSnapshotStore, type SnapshotRoot } from "@/infrastructure/workspace/WorkspaceSnapshot";

const execFileAsync = promisify(execFile);

suite("workspace state snapshots", () => {
  let temporary: string;
  let workspace: string;
  let roots: SnapshotRoot[];
  let store: WorkspaceSnapshotStore;

  setup(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "deepseek-workspace-snapshot-"));
    workspace = path.join(temporary, "workspace");
    await mkdir(workspace);
    roots = [{ uri: `file://${workspace}`, localPath: workspace, alias: "project" }];
    store = new WorkspaceSnapshotStore("chat-1", path.join(temporary, "data"));
    await mkdir(path.join(temporary, "data", "history", "chat-1"), { recursive: true });
    await writeFile(path.join(temporary, "data", "history", "chat-1", "manifest.json"), "{}");
  });
  teardown(async () => {await rm(temporary, { recursive: true, force: true });});

  test("first message captures state locally without sending source code", async () => {
    await writeFile(path.join(workspace, "auth.ts"), "const secretSource = 'do not send automatically';");
    const snapshot = await captureWorkspaceSnapshot(roots);
    assert.equal(workspaceChangeNotice(await store.load(), snapshot), "");
    await store.save(snapshot);
    assert.equal(store.directory, path.join(temporary, "data", "snapshoots", "chat-1"));
    const saved = await readFile(path.join(store.directory, ".snapshot", "state.json"), "utf8");
    assert.ok(saved.includes("project/auth.ts"));
    assert.ok(!saved.includes("secretSource"));
    assert.deepEqual(await new WorkspaceSnapshotStore("chat-1", path.join(temporary, "data")).load(), snapshot);
  });

  test("final state absorbs agent edits and the following unchanged turn has no notice", async () => {
    const file = path.join(workspace, "auth.ts");
    await writeFile(file, "before");
    await store.save(await captureWorkspaceSnapshot(roots));
    await writeFile(file, "agent's edit");
    await store.save(await captureWorkspaceSnapshot(roots));
    const current = await captureWorkspaceSnapshot(roots);
    assert.equal(workspaceChangeNotice(await store.load(), current), "");
    const index = path.join(store.directory, ".snapshot", "state.json");
    const inode = (await lstat(index)).ino;
    await store.save(current);
    assert.equal((await lstat(index)).ino, inode, "unchanged state must not replace the snapshot");
  });

  test("reports modifications, new files and deletions between turns without file contents", async () => {
    await writeFile(path.join(workspace, "changed.ts"), "old");
    await writeFile(path.join(workspace, "deleted.ts"), "old");
    const previous = await captureWorkspaceSnapshot(roots);
    await writeFile(path.join(workspace, "changed.ts"), "private new contents");
    await writeFile(path.join(workspace, "new.ts"), "private new contents");
    await rm(path.join(workspace, "deleted.ts"));
    const notice = workspaceChangeNotice(previous, await captureWorkspaceSnapshot(roots));
    assert.match(notice, /Modified: "project\/changed.ts"/);
    assert.match(notice, /Created: "project\/new.ts"/);
    assert.match(notice, /Deleted: "project\/deleted.ts"/);
    assert.ok(!notice.includes("private new contents"));
    assert.match(notice, /Read the affected files again/);
  });

  test("detects edits even when the Git status stays modified", async () => {
    await execFileAsync("git", ["init", workspace]);
    await writeFile(path.join(workspace, "file.txt"), "committed version");
    await execFileAsync("git", ["-C", workspace, "add", "file.txt"]);
    await writeFile(path.join(workspace, "file.txt"), "first edit");
    const before = await captureWorkspaceSnapshot(roots);
    await writeFile(path.join(workspace, "file.txt"), "other edit");
    assert.match(workspaceChangeNotice(before, await captureWorkspaceSnapshot(roots)), /Modified/);
  });

  test("includes untracked files, excludes Git-ignored files and does not read symlink targets", async () => {
    await execFileAsync("git", ["init", workspace]);
    await writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(workspace, "ignored.txt"), "ignored");
    await writeFile(path.join(workspace, "new.txt"), "new");
    const outside = path.join(temporary, "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(workspace, "link"));
    const before = await captureWorkspaceSnapshot(roots);
    assert.ok(!Object.hasOwn(before.files, "project/ignored.txt"));
    assert.ok(Object.hasOwn(before.files, "project/new.txt"));
    await writeFile(outside, "outside changed");
    assert.equal(workspaceChangeNotice(before, await captureWorkspaceSnapshot(roots)), "");
  });

  for (const parentIsRepository of [false, true]) {
    test(`respects nested repository ignores under a ${parentIsRepository ? "Git" : "plain"} workspace folder`, async () => {
      if (parentIsRepository) {await execFileAsync("git", ["init", workspace]);}
      const repository = path.join(workspace, "nested project");
      await mkdir(repository);
      await execFileAsync("git", ["init", repository]);
      await writeFile(path.join(workspace, "notes.txt"), "parent source");
      await writeFile(path.join(repository, ".gitignore"), "artifacts/\n.tmp/\n*.log\n");
      await writeFile(path.join(repository, "tracked.ts"), "tracked source");
      await execFileAsync("git", ["-C", repository, "add", ".gitignore", "tracked.ts"]);
      await writeFile(path.join(repository, "new.ts"), "untracked source");
      await writeFile(path.join(repository, "build.log"), "generated");
      for (const name of ["artifacts", ".tmp"]) {
        await mkdir(path.join(repository, name));
        await writeFile(path.join(repository, name, "generated.txt"), "do not copy");
      }
      const destination = path.join(temporary, "copy");
      const snapshot = await captureWorkspaceSnapshot(roots, undefined, undefined, destination);
      assert.deepEqual(Object.keys(snapshot.files), [
        "project/nested project/.gitignore", "project/nested project/new.ts", "project/nested project/tracked.ts", "project/notes.txt",
      ]);
      assert.equal(await readFile(path.join(destination, "nested project", "new.ts"), "utf8"), "untracked source");
      await assert.rejects(lstat(path.join(destination, "nested project", "artifacts")), { code: "ENOENT" });
    });
  }

  test("recognizes repositories with a .git file, including Git worktrees", async () => {
    const repository = path.join(temporary, "main-repo");
    await execFileAsync("git", ["init", repository]);
    await writeFile(path.join(repository, ".gitignore"), "artifacts/\n");
    await writeFile(path.join(repository, "source.ts"), "source");
    await execFileAsync("git", ["-C", repository, "add", "."]);
    await execFileAsync("git", ["-C", repository, "-c", "user.name=Snapshot Test", "-c", "user.email=snapshot@example.invalid", "commit", "-m", "fixture"]);
    const worktree = path.join(workspace, "checkout");
    await execFileAsync("git", ["-C", repository, "worktree", "add", "--detach", worktree]);
    assert.equal((await lstat(path.join(worktree, ".git"))).isFile(), true);
    await mkdir(path.join(worktree, "artifacts"));
    await writeFile(path.join(worktree, "artifacts", "generated.bin"), "generated");
    await writeFile(path.join(worktree, "new.ts"), "untracked");
    const snapshot = await captureWorkspaceSnapshot(roots);
    assert.deepEqual(Object.keys(snapshot.files), ["project/checkout/.gitignore", "project/checkout/new.ts", "project/checkout/source.ts"]);
  });

  test("accounts for unsaved editor contents", async () => {
    const file = path.join(workspace, "file.txt");
    await writeFile(file, "on disk");
    const before = await captureWorkspaceSnapshot(roots);
    const dirty = await captureWorkspaceSnapshot(roots, new Map([[file, "unsaved edit"]]));
    assert.match(workspaceChangeNotice(before, dirty), /Modified/);
    await writeFile(file, "unsaved edit");
    assert.equal(workspaceChangeNotice(dirty, await captureWorkspaceSnapshot(roots)), "");
  });

  test("handles multiple roots and warns when the bound workspace changes", async () => {
    const second = path.join(temporary, "second");
    await mkdir(second);
    await writeFile(path.join(workspace, "same.txt"), "one");
    await writeFile(path.join(second, "same.txt"), "two");
    const before = await captureWorkspaceSnapshot(roots);
    const after = await captureWorkspaceSnapshot([...roots, { uri: `file://${second}`, localPath: second, alias: "second" }]);
    assert.equal(Object.keys(after.files).length, 2);
    assert.match(workspaceChangeNotice(before, after), /Workspace changed/);
  });

  test("does not create storage for a deleted chat and removes its snapshot", async () => {
    await writeFile(path.join(workspace, "file.txt"), "text");
    const snapshot = await captureWorkspaceSnapshot(roots);
    await store.save(snapshot);
    await rm(path.join(temporary, "data", "history", "chat-1"), { recursive: true });
    await store.delete();
    await store.save(snapshot);
    assert.equal(await store.load(), undefined);
  });

  test("rejects path traversal and symlink storage", async () => {
    assert.throws(() => new WorkspaceSnapshotStore("../outside", temporary));
    await mkdir(path.join(temporary, "data", "snapshoots"));
    await symlink(workspace, store.directory);
    await assert.rejects(() => store.save({ version: 1, roots: [], files: {} }), /symbolic links/);
  });

  test("bounds notices and quotes unusual file names", async () => {
    const before = { version: 1 as const, roots: [], files: {} };
    const files = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`project/file-${index}\n.ts`, "0:hash"]));
    const notice = workspaceChangeNotice(before, { ...before, files });
    assert.ok(notice.length < 6600);
    assert.match(notice, /200 more changed paths omitted/);
    assert.ok(notice.includes('\\n.ts"'));
  });

  test("repairs a corrupt snapshot after reporting the failed check", async () => {
    const snapshot = await captureWorkspaceSnapshot(roots);
    await store.save(snapshot);
    await writeFile(path.join(store.directory, ".snapshot", "state.json"), "{corrupt");
    await assert.rejects(() => store.load());
    await store.save(snapshot);
    assert.deepEqual(await store.load(), snapshot);
  });
});

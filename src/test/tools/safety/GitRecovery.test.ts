import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { probeGitRecovery } from "@/infrastructure/tools/safety/GitRecovery";

const execute = promisify(execFile);
suite("Git recovery with real repositories", () => {
  let root: string;
  setup(async () => { root = await mkdtemp(path.join(tmpdir(), "git-recovery-")); });
  teardown(async () => { await rm(root, { recursive: true, force: true }); });
  const unavailable = { insideRepository: false, recoverable: false, reason: "git-unavailable" };
  async function git(...args: string[]) { return execute("git", ["-C", root, ...args]); }
  async function repository() {
    await git("init", "--quiet");
    await writeFile(path.join(root, "tracked.txt"), "original\n");
    await mkdir(path.join(root, "nested")); await writeFile(path.join(root, "nested", "space name.txt"), "nested\n");
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n"); await git("add", ".");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
  }
  test("rejects invalid targets without requiring a repository", async () => {
    for (const target of ["", "  ", "bad\0name", "bad\nname", "relative.txt"]) {
      assert.deepEqual(await probeGitRecovery(target), { insideRepository: false, recoverable: false, reason: "untracked-path" });
    }
  });
  test("identifies ordinary directories and nonexistent parents as nonrepositories", async () => {
    for (const target of [path.join(root, "file"), path.join(root, "missing", "file")]) {
      assert.deepEqual(await probeGitRecovery(target), { insideRepository: false, recoverable: false, reason: "not-a-repository" });
    }
  });
  test("clean committed files are recoverable through absolute or workspace-relative paths", async () => {
    await repository();
    for (const [target, options] of [[path.join(root, "tracked.txt"), {}], ["nested/space name.txt", { workspaceRoot: root }]] as const) {
      assert.deepEqual(await probeGitRecovery(target, options), { insideRepository: true, recoverable: true, reason: "recoverable" });
    }
  });
  test("untracked and ignored files report different recovery reasons", async () => {
    await repository();
    for (const [name, reason] of [["new.txt", "untracked-path"], ["ignored.txt", "ignored-path"]]) {
      await writeFile(path.join(root, name), "new\n");
      assert.deepEqual(await probeGitRecovery(name, { workspaceRoot: root }), { insideRepository: true, recoverable: false, reason });
    }
  });
  test("unstaged, staged and deleted files are not presented as safely recoverable", async () => {
    await repository(); await writeFile(path.join(root, "tracked.txt"), "modified\n");
    const expected = { insideRepository: true, recoverable: false, reason: "uncommitted-changes" };
    assert.deepEqual(await probeGitRecovery("tracked.txt", { workspaceRoot: root }), expected);
    await git("add", "tracked.txt"); assert.deepEqual(await probeGitRecovery("tracked.txt", { workspaceRoot: root }), expected);
    await rm(path.join(root, "tracked.txt")); assert.deepEqual(await probeGitRecovery("tracked.txt", { workspaceRoot: root }), expected);
  });
  test("unrelated dirty files do not prevent recovery of a clean target", async () => {
    await repository(); await writeFile(path.join(root, "nested", "space name.txt"), "changed");
    assert.equal((await probeGitRecovery("tracked.txt", { workspaceRoot: root })).recoverable, true);
  });
  test("bare repositories are not treated as working trees", async () => {
    await git("init", "--bare", "--quiet");
    assert.deepEqual(await probeGitRecovery(path.join(root, "HEAD")), { insideRepository: false, recoverable: false, reason: "not-a-repository" });
  });
  test("an already cancelled probe returns unavailable without invoking Git", async () => {
    await repository(); const abort = new AbortController(); abort.abort();
    assert.deepEqual(await probeGitRecovery("tracked.txt", { workspaceRoot: root, signal: abort.signal }), unavailable);
  });
  if (process.platform !== "win32") {
    for (const [command, flag, insideRepository] of [
      ["rev-parse", "--is-inside-work-tree", false],
      ["rev-parse", "--show-toplevel", true],
      ["check-ignore", "-q", true],
      ["ls-files", "--error-unmatch", true],
    ] as const) {
      test(`reports unavailable if Git disappears after ${command} ${flag}`, async () => {
        await repository();
        const oldPath = process.env.PATH;
        const executable = oldPath?.split(path.delimiter).map((directory) => path.join(directory, "git")).find((candidate) => existsSync(candidate));
        assert.ok(executable);
        const bin = path.join(root, "bin"); await mkdir(bin);
        const shim = path.join(bin, "git");
        // Execute the actual Git command, then simulate its executable disappearing
        // before the next independent probe stage.
        const script = `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const { unlinkSync } = require("node:fs");
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(realpathSync(executable))}, args, { env: { ...process.env, PATH: ${JSON.stringify(oldPath)} }, encoding: "utf8" });
if (args[2] === ${JSON.stringify(command)} && args[3] === ${JSON.stringify(flag)}) unlinkSync(__filename);
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || ""); process.exit(result.status ?? 1);
`;
        await writeFile(shim, script, { mode: 0o755 });
        await execute(shim, ["-C", root, "--version"]);
        try {
          process.env.PATH = bin;
          assert.deepEqual(await probeGitRecovery("tracked.txt", { workspaceRoot: root }), { ...unavailable, insideRepository });
        } finally {
          if (oldPath === undefined) { delete process.env.PATH; } else { process.env.PATH = oldPath; }
        }
      });
    }
  }

  test("missing Git executable reports unavailable", async () => {
    const oldPath = process.env.PATH;
    try { process.env.PATH = root; assert.deepEqual(await probeGitRecovery(path.join(root, "file")), unavailable); }
    finally { if (oldPath === undefined) { delete process.env.PATH; } else { process.env.PATH = oldPath; } }
  });
});

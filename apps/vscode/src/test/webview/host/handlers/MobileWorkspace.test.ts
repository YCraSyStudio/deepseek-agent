import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceFolder } from "vscode";
import { MobileError, MobileWorkspace } from "@/vscode/mobileIde/MobileWorkspace";
import { Uri, workspace } from "../../../support/VsCodeMock";

const execute = promisify(execFile);

suite("mobile workspace listing", () => {
  let root: string;
  let mobile: MobileWorkspace;

  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mobile-workspace-"));
    workspace.workspaceFolders = [{ uri: Uri.file(root), name: "project" }];
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(root, "notes.txt"), "notes\n");
    await writeFile(path.join(root, "ignored.txt"), "ignored\n");
    await git("init", "--quiet");
    await git("add", ".");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    mobile = new MobileWorkspace(workspace.workspaceFolders[0] as unknown as WorkspaceFolder);
  });

  teardown(async () => {
    workspace.workspaceFolders = undefined;
    await rm(root, { recursive: true, force: true });
  });

  function git(...args: string[]): Promise<{ stdout: string }> {
    return execute("git", ["-C", root, ...args]);
  }

  function commit(message: string): Promise<{ stdout: string }> {
    return git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
  }

  test("reports remote additions on the next listing", async () => {
    assert.deepEqual(await mobile.files(), ["notes.txt"]);
    await writeFile(path.join(root, "added.txt"), "added\n");
    await git("add", "added.txt");
    await commit("add");
    assert.deepEqual(await mobile.files(), ["added.txt", "notes.txt"]);
  });

  test("opens tracked hidden files such as .c8rc.json", async () => {
    await writeFile(path.join(root, ".c8rc.json"), "{}\n");
    await git("add", ".c8rc.json");
    await commit("hidden config");
    assert.deepEqual(await mobile.files(), [".c8rc.json", "notes.txt"]);
    assert.deepEqual(await mobile.read(".c8rc.json"), {
      text: "{}\n",
      revision: createHash("sha256").update("{}\n").digest("hex"),
    });
  });

  test("refuses files that are present on disk but not tracked", async () => {
    await writeFile(path.join(root, "draft.txt"), "draft\n");
    await assert.rejects(async () => mobile.read("draft.txt"), (error: unknown) =>
      error instanceof MobileError && error.status === 404 && error.code === "notTracked");
  });

  test("reports files deleted on the PC as missing and drops them from the listing", async () => {
    await unlink(path.join(root, "notes.txt"));
    assert.deepEqual(await mobile.files(), []);
    await assert.rejects(async () => mobile.read("notes.txt"), (error: unknown) =>
      error instanceof MobileError && error.status === 404 && error.code === "missing");
  });
});

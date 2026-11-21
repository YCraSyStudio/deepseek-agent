import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot, type WorkspaceRunSnapshot } from "@/vscode/workspace";
import { resolveLogicalPath, resolveAndValidateLogicalPath, resolveAllowedExternalPath, resolveDefaultLocalFolder, resolveSearchPatterns, isVirtualWorkspaceRoot, toResolvedUri, toLogicalUri, formatLogicalPath, toRelativeWorkspacePath, findFilesInRoot, toEntryType } from "@/vscode/tools/WorkspacePathResolver";
import { FileType, hostState, resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("workspace path resolver public boundaries", () => {
  let root: string; let one: string; let two: string;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "workspace-resolver-")); one = path.join(root, "one"); two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    workspace.workspaceFolders = [{ uri: Uri.file(one), name: "one" }];
  });
  teardown(async () => { resetVsCodeMock(); await rm(root, { recursive: true, force: true }); });
  function snapshot(multi = false): WorkspaceRunSnapshot { if (multi) { workspace.workspaceFolders = [{ uri: Uri.file(one), name: "one" }, { uri: Uri.file(two), name: "two" }]; } return captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding()); }
  test("single-root paths accept optional aliases and normalize separators", () => {
    const current = snapshot(); for (const [input, expected] of [["./file.ts", "file.ts"], ["one/file.ts", "file.ts"], ["one", "."], ["one/", "."], ["one\\folder\\file.ts", "folder/file.ts"]]) {
      const resolved = resolveLogicalPath(current, input); assert.equal(resolved.relativePath, expected); assert.equal(resolved.logicalPath, expected); assert.equal(resolved.folder.alias, "one");
    }
    assert.equal(toResolvedUri(current, ".").fsPath, one); assert.equal(toLogicalUri(resolveLogicalPath(current, "folder/file.ts")).fsPath, path.join(one, "folder", "file.ts"));
  });
  test("multi-root paths require a known alias and keep root identity", () => {
    const current = snapshot(true); assert.equal(resolveLogicalPath(current, "two/file.ts").logicalPath, "two/file.ts"); assert.equal(resolveLogicalPath(current, "two").relativePath, "."); assert.equal(resolveLogicalPath(current, "two").logicalPath, "two");
    assert.throws(() => resolveLogicalPath(current, "file.ts"), /must start with one of/); assert.throws(() => resolveLogicalPath(current, "unknown/file.ts"), /one, two/);
    assert.equal(formatLogicalPath(current, current.folders[1], "file.ts"), "two/file.ts"); assert.equal(isVirtualWorkspaceRoot(current, "./."), true); assert.equal(isVirtualWorkspaceRoot(current, "one"), false);
  });
  test("validates missing paths, traversal, absolute paths and URI-shaped paths", () => {
    const current = snapshot();
    for (const input of ["", "  ", "a\0b"]) { assert.throws(() => resolveLogicalPath(current, input), /path is required/); }
    for (const input of ["..", "one/../file", "folder\\..\\file"]) { assert.throws(() => resolveLogicalPath(current, input), /traversal/); }
    for (const input of ["/absolute", "C:\\absolute", "file:///absolute", "https://example.com/file"]) { assert.throws(() => resolveLogicalPath(current, input), /must be relative/); }
    workspace.workspaceFolders = []; assert.throws(() => resolveLogicalPath(snapshot(), "file"), /No workspace folder/);
  });
  test("terminal defaults use the chosen root, single root or an explicit ambiguity error", () => {
    const single = snapshot(); assert.equal(resolveDefaultLocalFolder(single).folder.localPath, one); assert.equal(formatLogicalPath(single, single.folders[0], "file"), "file"); assert.equal(isVirtualWorkspaceRoot(single, "."), false);
    const current = snapshot(true); assert.throws(() => resolveDefaultLocalFolder({ ...current, defaultFolderAlias: undefined }), /Terminal cwd is required/);
    assert.equal(resolveDefaultLocalFolder({ ...current, defaultFolderAlias: "two" }).folder.localPath, two);
  });
  test("external filesystem access requires explicit admission and an unambiguous base", () => {
    const current = snapshot(); const external = path.join(root, "outside.txt"); assert.equal(resolveAllowedExternalPath(current, external, false), undefined); assert.equal(resolveAllowedExternalPath(current, external, true), external);
    for (const input of ["", "  ", "bad\0path", "file.ts"]) { assert.equal(resolveAllowedExternalPath(current, input, true), undefined); }
    assert.throws(() => resolveAllowedExternalPath(current, "https://example.com", true), /not URIs/);
    assert.equal(resolveAllowedExternalPath(current, "../outside.txt", true), external);
    const multi = snapshot(true); assert.throws(() => resolveAllowedExternalPath({ ...multi, defaultFolderAlias: undefined }, "../outside.txt", true), /absolute filesystem path/);
    assert.equal(resolveAllowedExternalPath({ ...multi, defaultFolderAlias: "two" }, "../outside.txt", true), external);
  });
  test("validates real paths and refuses sensitive paths and symlink escapes", async () => {
    await writeFile(path.join(one, "file.ts"), "contents"); await writeFile(path.join(one, ".env"), "fixture"); await writeFile(path.join(root, "outside"), "outside"); await symlink(path.join(root, "outside"), path.join(one, "escape"));
    const current = snapshot(); assert.equal((await resolveAndValidateLogicalPath(current, "file.ts", false)).logicalPath, "file.ts");
    await assert.rejects(resolveAndValidateLogicalPath(current, ".env", false), /sensitive/); assert.equal((await resolveAndValidateLogicalPath(current, ".env", true)).logicalPath, ".env");
    await assert.rejects(resolveAndValidateLogicalPath(current, "escape", true), /outside|escape/i);
  });
  test("remote path validation checks every visible segment and rejects symbolic links", async () => {
    workspace.workspaceFolders = [{ uri: Uri.parse("vscode-remote://ssh-remote+host/project"), name: "remote" }]; const current = snapshot(); const checked: string[] = [];
    hostState.stat = async (uri) => { checked.push(uri.toString()); return { type: FileType.Directory, size: 0 }; };
    await resolveAndValidateLogicalPath(current, "folder/file.ts", false); assert.deepEqual(checked, ["vscode-remote://ssh-remote+host/project/folder", "vscode-remote://ssh-remote+host/project/folder/file.ts"]);
    hostState.stat = async () => ({ type: FileType.SymbolicLink | FileType.Directory, size: 0 }); await assert.rejects(resolveAndValidateLogicalPath(current, "link/file.ts", true), /Symbolic links/);
  });
  test("remote missing resources allow new paths while permission errors propagate", async () => {
    workspace.workspaceFolders = [{ uri: Uri.parse("vscode-remote://ssh-remote+host/project"), name: "remote" }]; const current = snapshot();
    for (const message of ["FileNotFound", "Unable to resolve resource"]) { hostState.stat = async () => { throw new Error(message); }; assert.equal((await resolveAndValidateLogicalPath(current, "new/file.ts", true)).relativePath, "new/file.ts"); }
    for (const error of [new Error("permission denied"), "unavailable"]) { hostState.stat = async () => { throw error; }; await assert.rejects(resolveAndValidateLogicalPath(current, "file.ts", true), (actual) => actual === error); }
  });
  test("search patterns support root selection, defaults and multi-root fanout", () => {
    const current = snapshot(true); assert.deepEqual(resolveSearchPatterns(current, "two/src/*.ts").map((entry) => [entry.folder.alias, entry.pattern]), [["two", "src/*.ts"]]);
    assert.deepEqual(resolveSearchPatterns(current, "one").map((entry) => entry.pattern), ["**/*"]);
    assert.deepEqual(resolveSearchPatterns(current, "").map((entry) => [entry.folder.alias, entry.pattern]), [["one", "**/*"], ["two", "**/*"]]);
    assert.deepEqual(resolveSearchPatterns(current, "./src\\*.ts").map((entry) => entry.pattern), ["src/*.ts", "src/*.ts"]);
    for (const pattern of ["../file", "/absolute", "file:///root", "C:\\root"]) { assert.throws(() => resolveSearchPatterns(current, pattern), /stay inside/); }
  });
  test("relative search results must retain scheme, authority and root containment", () => {
    const local = Uri.file(one) as vscode.Uri; assert.equal(toRelativeWorkspacePath(local, Uri.file(path.join(one, "src", "file.ts")) as vscode.Uri), "src/file.ts");
    for (const uri of [Uri.file(root), Uri.file(path.join(two, "file.ts")), Uri.parse("vscode-remote://host/project/file.ts")]) { assert.throws(() => toRelativeWorkspacePath(local, uri as vscode.Uri), /outside/); }
    const remote = Uri.parse("vscode-remote://host/project") as vscode.Uri; assert.equal(toRelativeWorkspacePath(remote, Uri.parse("vscode-remote://host/project/src/file.ts") as vscode.Uri), "src/file.ts");
    assert.throws(() => toRelativeWorkspacePath(remote, Uri.parse("vscode-remote://other/project/file.ts") as vscode.Uri), /outside/);
  });
  test("native searches preserve root, pattern, limit and result URIs and dispose cancellation", async () => {
    const rootUri = Uri.file(one) as vscode.Uri; const resource = Uri.file(path.join(one, "file.ts"));
    hostState.findFiles = async (pattern, exclude, max, token) => { assert.equal(pattern.base.toString(), rootUri.toString()); assert.equal(pattern.pattern, "**/*.ts"); assert.equal(exclude, undefined); assert.equal(max, 20); assert.equal(token.isCancellationRequested, false); return [resource]; };
    assert.deepEqual(await findFilesInRoot(rootUri, "**/*.ts", 20), [resource]); assert.equal(hostState.cancellations[0].disposed, true);
  });
  test("aborted searches reject, propagate cancellation and release SDK tokens", async () => {
    const controller = new AbortController(); hostState.findFiles = async (_pattern, _exclude, _max, token) => { controller.abort(); assert.equal(token.isCancellationRequested, true); return []; };
    await assert.rejects(findFilesInRoot(Uri.file(one) as vscode.Uri, "*", 20, controller.signal), { name: "AbortError", message: "Workspace search cancelled" }); assert.ok(hostState.cancellations[0].disposed);
    hostState.findFiles = async () => { throw new Error("search failed"); }; await assert.rejects(findFilesInRoot(Uri.file(one) as vscode.Uri, "*", 20), /search failed/); assert.ok(hostState.cancellations[1].disposed);
  });
  test("classifies native entry flags without treating symbolic links as files", () => {
    assert.equal(toEntryType(FileType.Directory), "directory"); assert.equal(toEntryType(FileType.File), "file"); assert.equal(toEntryType(FileType.SymbolicLink), "unknown"); assert.equal(toEntryType(FileType.Unknown), "unknown");
  });
});

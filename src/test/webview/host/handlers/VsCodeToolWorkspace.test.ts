import assert from "node:assert/strict";
import { realpath, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot } from "@/vscode/workspace";
import { fileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";
import { createHash } from "node:crypto";
import { hostState, resetVsCodeMock, Position, SymbolInformation, Uri, window, workspace } from "../../../support/VsCodeMock";

suite("VS Code tool workspace real filesystem behavior", () => {
  let root: string; let project: string;
  setup(async () => { resetVsCodeMock(); root = await realpath(await mkdtemp(path.join(tmpdir(), "tool-workspace-"))); project = path.join(root, "project"); await mkdir(project); workspace.workspaceFolders = [{ uri: Uri.file(project), name: "project" }]; });
  teardown(async () => { resetVsCodeMock(); await rm(root, { recursive: true, force: true }); });
  function host(options: Parameters<typeof createVsCodeToolWorkspace>[1] = {}) { return createVsCodeToolWorkspace(captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding()), options); }
  test("reports root, stable identity and the configured system shell", () => {
    const scoped = host(); assert.equal(scoped.getRootPath(), project); assert.equal(scoped.getWorkspaceId!(), captureCurrentWorkspaceBinding().uri); assert.ok(scoped.getCommandShell!()); assert.equal(host({ unrestricted: true }).getWorkspaceId!(), "computer:unrestricted");
  });
  test("multi-root virtual directories retain aliases and obey selected terminal roots", async () => {
    const second = path.join(root, "second"); await mkdir(second); workspace.workspaceFolders!.push({ uri: Uri.file(second), name: "second" });
    const snapshot = captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding()); const scoped = createVsCodeToolWorkspace(snapshot);
    assert.equal(scoped.getRootPath(), undefined); assert.equal(await scoped.resolvePath!(".", false), "."); assert.deepEqual(await scoped.stat!("."), { type: "directory", size: 0 }); assert.deepEqual(await scoped.readDirectory!("."), [["project", "directory"], ["second", "directory"]]);
    assert.equal(createVsCodeToolWorkspace({ ...snapshot, defaultFolderAlias: "second" }).getRootPath(), second);
  });
  test("containment rejects traversal and symlink escapes but accepts inside absolute paths", async () => {
    const outside = path.join(root, "outside.txt"); await writeFile(outside, "outside"); await writeFile(path.join(project, "inside.txt"), "inside"); await symlink(outside, path.join(project, "escape")); const scoped = host();
    assert.equal(await scoped.isPathInsideWorkspace!(path.join(project, "inside.txt")), true); assert.equal(await scoped.isPathInsideWorkspace!(outside), false); assert.equal(await scoped.isPathInsideWorkspace!("escape"), false); assert.equal(await scoped.isPathInsideWorkspace!("../outside.txt"), false); assert.equal(await scoped.isPathInsideWorkspace!("inside.txt"), true);
  });
  test("external access is explicit and carries the local workspace root into terminal resolution", async () => {
    const outside = path.join(root, "outside"); await mkdir(outside); const scoped = host({ allowOutsideWorkspace: true });
    assert.equal(await scoped.resolvePath!(outside, true), outside); const resolved = await scoped.resolveLocalPath!(outside); assert.equal(resolved.absolutePath, outside); assert.equal(resolved.workspaceRoot, project);
    assert.equal((await scoped.resolveLocalPath!()).absolutePath, project); assert.equal(await scoped.realPath!(outside), outside);
    workspace.workspaceFolders = []; await assert.rejects(host({ allowOutsideWorkspace: true }).resolveLocalPath!(outside), /local workspace root is required/);
  });
  test("sensitive files are restricted unless the host is unrestricted", async () => {
    await writeFile(path.join(project, ".env"), "fixture"); await assert.rejects(host().resolvePath!(".env", false), /sensitive/);
    const scoped = host({ unrestricted: true }); assert.equal(await scoped.resolvePath!(".env", false), ".env"); assert.equal(Buffer.from(await scoped.readFile!(".env")).toString(), "fixture");
  });
  test("reads unsaved open buffers in preference to disk", async () => {
    const uri = Uri.file(path.join(project, "file.txt")); await writeFile(uri.fsPath, "saved"); workspace.textDocuments = [{ uri, isDirty: true, getText: () => "unsaved user text" }];
    assert.equal(Buffer.from(await host().readFile!("file.txt")).toString(), "unsaved user text"); assert.equal(await readFile(uri.fsPath, "utf8"), "saved"); workspace.textDocuments = [];
    assert.equal(Buffer.from(await host().readFile!("file.txt")).toString(), "saved");
  });
  test("bounded previews return full small files and separate head/tail bytes for large files", async () => {
    await writeFile(path.join(project, "file.txt"), "0123456789"); const scoped = host();
    const full = await scoped.readFilePreview!("file.txt", 10); assert.equal(Buffer.from(full.head).toString(), "0123456789"); assert.equal(full.tail, undefined); assert.equal(full.size, 10);
    const preview = await scoped.readFilePreview!("file.txt", 5); assert.equal(Buffer.from(preview.head).toString(), "012"); assert.equal(Buffer.from(preview.tail!).toString(), "89"); assert.equal(preview.size, 10);
    const one = await scoped.readFilePreview!("file.txt", 1); assert.equal(Buffer.from(one.head).toString(), "0"); assert.equal(one.tail!.length, 0);
    for (const limit of [0, -1, 1.5, NaN]) { await assert.rejects(scoped.readFilePreview!("file.txt", limit), /positive integer/); }
  });
  test("writes closed files and retains before/after versions for review", async () => {
    const scoped = host(); await writeFile(path.join(project, "file.txt"), "before"); await scoped.writeFile!("file.txt", Buffer.from("after")); assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "after");
    const hash = createHash("sha256").update("after").digest("hex"); const change = fileChangeRegistry.find("file.txt", undefined, hash); assert.equal(change?.before, "before"); assert.equal(change?.after, "after");
    await scoped.createParentDirectory!("nested/new.txt"); await scoped.writeFile!("nested/new.txt", Buffer.from("created")); assert.equal(await readFile(path.join(project, "nested", "new.txt"), "utf8"), "created");
    await scoped.createParentDirectory!("root-file.txt");
  });
  test("moves respect overwrite admission and deletes remove only the selected file", async () => {
    const scoped = host(); await writeFile(path.join(project, "source.txt"), "source"); await writeFile(path.join(project, "destination.txt"), "destination");
    await assert.rejects(scoped.movePath!("source.txt", { destination: "source.txt" }), /same path/); await assert.rejects(scoped.movePath!("source.txt", { destination: "destination.txt" }), /already exists/); assert.equal(await readFile(path.join(project, "destination.txt"), "utf8"), "destination");
    await scoped.movePath!("source.txt", { destination: "destination.txt", overwrite: true }); assert.equal(await readFile(path.join(project, "destination.txt"), "utf8"), "source"); await assert.rejects(readFile(path.join(project, "source.txt")), /ENOENT/);
    await scoped.deletePath!("destination.txt", { recursive: false, useTrash: false }); await assert.rejects(readFile(path.join(project, "destination.txt")), /ENOENT/);
  });
  test("external operations use explicitly admitted filesystem paths", async () => {
    const scoped = host({ allowOutsideWorkspace: true }); const external = path.join(root, "external", "file.txt"); await scoped.createParentDirectory!(external); await scoped.writeFile!(external, Buffer.from("external"));
    assert.equal(Buffer.from(await scoped.readFile!(external)).toString(), "external"); assert.equal((await scoped.stat!(external)).type, "file"); assert.equal(Buffer.from((await scoped.readFilePreview!(external, 100)).head).toString(), "external"); assert.deepEqual(await scoped.readDirectory!(path.dirname(external)), [["file.txt", "file"]]);
    hostState.commandHandlers.set("vscode.executeDocumentSymbolProvider", (uri) => { assert.equal((uri as { fsPath: string }).fsPath, external); return []; });
    assert.deepEqual(await scoped.readDocumentSymbols!(external), []);
    const moved = path.join(path.dirname(external), "moved.txt"); await scoped.movePath!(external, { destination: moved }); assert.equal(await readFile(moved, "utf8"), "external");
    await scoped.deletePath!(moved, { recursive: false, useTrash: false }); assert.deepEqual(await scoped.readDirectory!(path.dirname(external)), []);
  });
  test("searches use remaining capacity and preserve multi-root logical paths", async () => {
    const second = path.join(root, "second"); await mkdir(second); workspace.workspaceFolders!.push({ uri: Uri.file(second), name: "second" }); const calls: number[] = [];
    hostState.findFiles = async (pattern, _exclude, max) => { calls.push(max); return pattern.base.fsPath === project ? [Uri.file(path.join(project, "a.ts")), Uri.file(path.join(project, "b.ts"))] : [Uri.file(path.join(second, "c.ts"))]; };
    const scoped = host(); assert.deepEqual(await scoped.findFiles!({ includePattern: "**/*.ts", maxResults: 3 }), ["project/a.ts", "project/b.ts", "second/c.ts"]); assert.deepEqual(calls, [3, 1]);
    calls.length = 0; assert.deepEqual(await scoped.findFiles!({ includePattern: "*", maxResults: 0 }), []); assert.deepEqual(calls, []);
    const controller = new AbortController(); controller.abort(); await assert.rejects(scoped.findFiles!({ includePattern: "*", maxResults: 3, signal: controller.signal }), { name: "AbortError" });
  });
  test("native document symbols retain hierarchy and support legacy symbol information", async () => {
    await writeFile(path.join(project, "file.ts"), "source"); const legacy = Object.assign(new SymbolInformation(), { name: "legacy", kind: 11, location: { range: { start: { line: 2 }, end: { line: 4 } } } });
    hostState.commandHandlers.set("vscode.executeDocumentSymbolProvider", () => [{ name: "Class", kind: 4, range: { start: { line: 0 }, end: { line: 10 } }, selectionRange: { start: { line: 1 } }, children: [{ name: "unknown", kind: 999, range: { start: { line: 3 }, end: { line: 4 } }, selectionRange: { start: { line: 3 } }, children: [] }] }, legacy]);
    const symbols = await host().readDocumentSymbols!("file.ts"); assert.deepEqual(symbols.map((symbol) => [symbol.name, symbol.kind, symbol.nameLine]), [["Class", "class", 1], ["legacy", "function", 2]]); assert.equal(symbols[0].children[0].kind, "symbol");
    hostState.commandHandlers.set("vscode.executeDocumentSymbolProvider", () => undefined); assert.deepEqual(await host().readDocumentSymbols!("file.ts"), []);
  });
  test("preparing a diff for a closed file does not open an editor or modify its contents", async () => {
    const file = path.join(project, "closed.txt"); await writeFile(file, "before"); const scoped = host();
    await scoped.prepareFileDiff!("closed.txt", "before", "after"); scoped.clearFileDiffPreview!();
    assert.deepEqual(hostState.opened, []); assert.equal(await readFile(file, "utf8"), "before");
  });

  test("unavailable trash never silently falls back to permanent deletion", async () => {
    await writeFile(path.join(project, "keep.txt"), "preserve"); const original = workspace.fs.delete;
    try {
      for (const failure of [new Error("Trash unavailable"), "ENOTSUP"]) {
        workspace.fs.delete = async () => { throw failure; }; await assert.rejects(host().deletePath!("keep.txt", { recursive: false, useTrash: true }), /trash is unavailable/);
        assert.equal(await readFile(path.join(project, "keep.txt"), "utf8"), "preserve");
      }
      for (const permission of [new Error("permission denied"), { code: "EACCES" }]) {
        workspace.fs.delete = async () => { throw permission; };
        await assert.rejects(host().deletePath!("keep.txt", { recursive: false, useTrash: true }), (error) => error === permission);
      }
    } finally { workspace.fs.delete = original; }
  });
  test("rejected open-editor edits preserve both the unsaved buffer and disk file", async () => {
    const uri = Uri.file(path.join(project, "open.txt")); await writeFile(uri.fsPath, "saved"); let proposed: unknown[] = [];
    const document = { uri, isDirty: true, getText: () => "unsaved user text", positionAt: (offset: number) => new Position(0, offset) }; workspace.textDocuments = [document];
    window.visibleTextEditors = [{ document, edit: async (...args) => { proposed = args; return false; } }];
    await assert.rejects(host().writeFile!("open.txt", Buffer.from("replacement")), /VS Code rejected the edit/); assert.deepEqual(proposed[1], { undoStopBefore: true, undoStopAfter: true });
    assert.equal(document.getText(), "unsaved user text"); assert.equal(await readFile(uri.fsPath, "utf8"), "saved");
    proposed = []; await assert.rejects(host().writeFile!("open.txt", Buffer.from([255, 0])), /binary or invalid UTF-8/); assert.deepEqual(proposed, []);
  });
  test("remote file previews return bounded head bytes without pretending to have a local tail", async () => {
    workspace.workspaceFolders = [{ uri: Uri.parse("vscode-remote://host/project"), name: "remote" }]; hostState.stat = async () => ({ type: 1, size: 10 }); const original = workspace.fs.readFile;
    workspace.fs.readFile = async () => Buffer.from("0123456789");
    try { const preview = await host().readFilePreview!("file.txt", 5); assert.equal(Buffer.from(preview.head).toString(), "01234"); assert.equal(preview.tail, undefined); assert.equal(preview.size, 10); }
    finally { workspace.fs.readFile = original; }
  });
  if (process.platform !== "win32") {
    test("owned shell execution returns the command output through the host adapter", async () => {
      const result = await host({ conversationId: "fixture-chat" }).executeCommand!("printf adapter-command", { cwd: project, workspaceRoot: project, timeoutMs: 2000, maxOutputBytes: 1024 });
      assert.equal(result.stdout, "adapter-command"); assert.equal(result.exitCode, 0); assert.equal(result.timedOut, false);
    });
  }

  test("remote roots do not claim local terminal paths or local trash support", async () => {
    workspace.workspaceFolders = [{ uri: Uri.parse("vscode-remote://host/project"), name: "remote" }]; hostState.stat = async () => ({ type: 1, size: 0 }); const scoped = host();
    await assert.rejects(scoped.resolveLocalPath!("."), /Terminal is unavailable/); assert.equal(await scoped.isPathInsideWorkspace!(path.join(project, "file.ts")), false);
    await assert.rejects(scoped.deletePath!("file.ts", { recursive: false, useTrash: true }), /only supported for local/);
  });
});

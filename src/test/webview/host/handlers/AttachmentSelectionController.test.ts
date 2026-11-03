import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { AttachmentSelectionController } from "@/vscode/webviews/AttachmentSelectionController";
import type { ImageAttachmentController } from "@/vscode/webviews/ImageAttachmentController";
import type { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { dialogs, hostState, resetVsCodeMock, Uri } from "../../../support/VsCodeMock";

suite("attachment selection public workflow", () => {
  let root: string; let posts: Array<Record<string, unknown>>; let registered: unknown[]; let requests: Array<string | undefined>;
  let controller: AttachmentSelectionController; let view: vscode.WebviewView;
  let folders: Array<{ uri: string; alias: string }>; let fail: Error | undefined;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "attachment-selection-")); posts = []; registered = []; requests = []; folders = []; fail = undefined;
    controller = new AttachmentSelectionController({
      chatHandler: { getWorkspaceContext: async (id?: string) => { requests.push(id); return { binding: { folders, revision: 7 } }; }, registerExternalContextFiles: (files: unknown[]) => { registered = files; } } as unknown as ChatHandler,
      imageAttachments: { classifyAndUpload: async (_webview: unknown, uris: vscode.Uri[]) => { if (fail) { throw fail; } return { attachments: [], contextUris: uris }; } } as unknown as ImageAttachmentController,
    });
    view = { webview: { postMessage: async (message: Record<string, unknown>) => { posts.push(message); return true; } } } as unknown as vscode.WebviewView;
  });
  teardown(async () => { resetVsCodeMock(); await rm(root, { recursive: true, force: true }); });
  async function select(names: string[], contents: string | Uint8Array = "contents") {
    hostState.selectedFolders = await Promise.all(names.map(async (name) => {
      const uri = Uri.file(path.join(root, name)); await mkdir(path.dirname(uri.fsPath), { recursive: true }); await writeFile(uri.fsPath, contents); return uri;
    }));
    await controller.select("selection", "chat-1", view);
    return (posts.find((post) => post.type === "contextFilesSelected")?.files ?? []) as Array<Record<string, unknown>>;
  }
  test("cancel and empty selection produce no messages or context lookup", async () => {
    await controller.select("cancel", undefined, view); hostState.selectedFolders = []; await controller.select("empty", undefined, view);
    assert.deepEqual(posts, []); assert.deepEqual(requests, []);
  });
  test("correlates upload errors without registering context files", async () => {
    fail = new Error("upload failed"); await select(["a.txt"]);
    assert.deepEqual(posts, [{ type: "imageAttachmentsSelected", requestId: "selection", attachments: [], error: "upload failed" }]); assert.deepEqual(registered, []);
  });
  test("registers external files as read-only snapshots with no absolute path", async () => {
    const files = await select(["external.ts", "README"]);
    assert.equal(posts[0].type, "imageAttachmentsSelected"); assert.deepEqual(requests, ["chat-1"]); assert.deepEqual(registered, files);
    assert.equal(files[0].scope, "external-snapshot"); assert.equal(files[0].path, "external.ts"); assert.equal(files[0].language, "ts");
    assert.equal(files[0].content, "contents"); assert.equal(files[0].rootUri, undefined); assert.equal(files[1].language, undefined); assert.ok(files[0].referenceId);
  });
  test("binds internal files to the selected workspace revision and prefixes multi-root aliases", async () => {
    folders = [{ uri: Uri.file(root).toString(), alias: "main" }];
    let files = await select(["src/app.ts"]); assert.equal(files[0].path, "./src/app.ts"); assert.equal(files[0].bindingRevision, 7); assert.equal(files[0].rootUri, folders[0].uri); assert.equal(files[0].scope, "workspace");
    posts = []; folders.push({ uri: Uri.file(path.join(root, "other")).toString(), alias: "other" });
    files = await select(["src/app.ts"]); assert.equal(files[0].path, "./main/src/app.ts");
  });
  test("skips binary, missing, directory and oversized files without failing other selections", async () => {
    const binary = Uri.file(path.join(root, "binary")); await writeFile(binary.fsPath, Buffer.from([0]));
    const text = Uri.file(path.join(root, "large")); await writeFile(text.fsPath, Buffer.alloc(1024 * 1024 + 1, 65));
    hostState.selectedFolders = [binary, text, Uri.file(root), Uri.file(path.join(root, "missing"))];
    await controller.select("selection", undefined, view); assert.deepEqual(posts[1].files, []); assert.deepEqual(registered, []);
  });
  test("requires explicit approval for sensitive files and keeps approved files as snapshots", async () => {
    folders = [{ uri: Uri.file(root).toString(), alias: "main" }];
    assert.deepEqual(await select([".env"]), []); assert.equal(dialogs.warnings.length, 1);
    posts = []; dialogs.warning = "Add snapshot";
    const files = await select([".env"]); assert.equal(files.length, 1); assert.equal(files[0].scope, "external-snapshot"); assert.equal(files[0].path, ".env"); assert.equal(files[0].bindingRevision, undefined);
  });
  test("bounds context selection to ten files", async () => {
    const files = await select(Array.from({ length: 12 }, (_, index) => `${index}.txt`)); assert.equal(files.length, 10); assert.equal(files[9].path, "9.txt");
  });
});

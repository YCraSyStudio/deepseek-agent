import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG } from "@/contracts";
import type { SecretStore, SettingsRepository } from "@/application/ports";
import { ImageAttachmentController } from "@/vscode/webviews/ImageAttachmentController";
import { hostState, resetVsCodeMock, Uri } from "../../../support/VsCodeMock";

suite("image attachment controller public workflows", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let root: string; let originalFetch: typeof fetch; let previousMode: string | undefined; let previousData: string | undefined;
  let key: string | undefined; let uploads: number; let deleted: string[]; let waits: number;
  let controller: ImageAttachmentController; let webview: vscode.Webview;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "image-controller-")); originalFetch = globalThis.fetch;
    previousMode = process.env.NODE_ENV; previousData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(root, "data");
    key = "test-key"; uploads = 0; deleted = []; waits = 0;
    controller = new ImageAttachmentController({ globalStorageUri: Uri.file(root) } as unknown as vscode.ExtensionContext,
      { load: () => ({ ...DEFAULT_CONFIG, privacyMinimizeData: false }), waitForPendingWrites: async () => { waits++; } } as unknown as SettingsRepository,
      { getApiKey: async () => key } as unknown as SecretStore);
    webview = { options: {}, asWebviewUri: (uri: vscode.Uri) => ({ toString: () => `preview:${uri.toString()}` }) } as unknown as vscode.Webview;
    globalThis.fetch = async (input, init) => {
      if (init?.method === "DELETE") { deleted.push(String(input)); return Response.json({ deleted: true }); }
      uploads++; return Response.json({ id: `file-api-${uploads}`, bytes: png.length, created_at: 100, filename: "image.png", ...(uploads === 1 ? { expires_at: 200 } : {}) });
    };
  });
  teardown(async () => {
    globalThis.fetch = originalFetch; resetVsCodeMock();
    for (const [name, value] of [["NODE_ENV", previousMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", previousData]]) {
      if (value === undefined) { delete process.env[name!]; } else { process.env[name!] = value; }
    }
    await rm(root, { recursive: true, force: true });
  });
  async function file(name: string, bytes = png) { const uri = Uri.file(path.join(root, name)) as vscode.Uri; await writeFile(uri.fsPath, bytes); return uri; }
  function paste(name = "image.png", bytes = png) { return controller.uploadClipboard(webview, { name, size: bytes.length, dataBase64: bytes.toString("base64") }); }

  test("separates ordinary context files, empty files and directories from actual image content", async () => {
    const text = await file("text.png", Buffer.from("ordinary text")); const empty = await file("empty", Buffer.alloc(0));
    const directory = Uri.file(path.join(root, "folder")) as vscode.Uri; await mkdir(directory.fsPath);
    const image = await file("actual.dat");
    const result = await controller.classifyAndUpload(webview, [text, empty, directory, image, image]);
    assert.deepEqual(result.contextUris, [text, empty, directory]); assert.equal(result.attachments.length, 2); assert.equal(waits, 1);
    assert.equal(result.attachments[0].source, "picker"); assert.equal(result.attachments[0].mediaType, "image/png");
    assert.equal(result.attachments[0].uploadedAt, 100_000); assert.equal(result.attachments[0].expiresAt, 200_000);
    assert.equal(result.attachments[1].expiresAt, (100 + 30 * 86400) * 1000);
    for (const attachment of result.attachments) { assert.deepEqual(await readFile(controller.getCacheUri(attachment.cacheFileName).fsPath), png); assert.match(attachment.previewUri!, /^preview:/); }
  });

  test("does not load credentials for context-only selections", async () => {
    key = undefined; const uri = await file("plain", Buffer.from("text"));
    assert.deepEqual((await controller.classifyAndUpload(webview, [uri])).contextUris, [uri]); assert.equal(waits, 0); assert.equal(uploads, 0);
  });

  test("rejects oversized image names but leaves oversized nonimages as context without reading", async () => {
    hostState.stat = async () => ({ type: 1, size: 64 * 1024 * 1024 + 1 });
    const text = Uri.file(path.join(root, "large.txt")) as vscode.Uri;
    assert.deepEqual((await controller.classifyAndUpload(webview, [text])).contextUris, [text]);
    await assert.rejects(controller.classifyAndUpload(webview, [Uri.file(path.join(root, "large.JPEG")) as vscode.Uri]), /64 MiB/); assert.equal(uploads, 0);
  });

  test("cleans up all eight uploads when a ninth image is selected", async () => {
    const image = await file("photo.png");
    await assert.rejects(controller.classifyAndUpload(webview, Array.from({ length: 9 }, () => image)), /at most 8/);
    assert.equal(uploads, 8); assert.equal(deleted.length, 8); assert.deepEqual(await readdir(controller.cacheRoot.fsPath), []);
  });

  test("preserves a selection failure when remote cleanup also fails", async () => {
    const image = await file("photo.png"); const fetchUpload = globalThis.fetch;
    globalThis.fetch = async (input, init) => { if (init?.method === "DELETE") { throw new Error("cleanup failed"); } return fetchUpload(input, init); };
    await assert.rejects(controller.classifyAndUpload(webview, [image, Uri.file(path.join(root, "missing")) as vscode.Uri]), /ENOENT/);
    assert.deepEqual(await readdir(controller.cacheRoot.fsPath), []);
  });

  test("requires credentials for both picker and clipboard images", async () => {
    key = undefined; await assert.rejects(paste(), /Configure.*API key/);
    await assert.rejects(controller.classifyAndUpload(webview, [await file("photo.png")]), /Configure.*API key/); assert.equal(uploads, 0);
  });

  test("rejects incomplete, empty, unsupported and oversized clipboard payloads before upload", async () => {
    await assert.rejects(controller.uploadClipboard(webview, { name: "x", size: 10, dataBase64: png.toString("base64") }), /incomplete/);
    await assert.rejects(paste("empty", Buffer.alloc(0)), /64 MiB/);
    await assert.rejects(paste("plain", Buffer.from("text")), /not a supported/);
    await assert.rejects(paste("huge", Buffer.alloc(64 * 1024 * 1024 + 1)), /64 MiB/); assert.equal(uploads, 0);
  });

  test("sanitizes clipboard filenames and preserves source and detected extension", async () => {
    const attachment = await paste(' a/b?:*.png '); assert.equal(attachment.name, "a_b___.png"); assert.equal(attachment.source, "clipboard");
    assert.equal((await paste("   ")).name, "image"); assert.match((await paste("")).name, /^image-/);
    assert.equal((await paste("x".repeat(600))).name.length, 512);
    const jpeg = await paste("photo", Buffer.from([255, 216, 255])); assert.equal(jpeg.mediaType, "image/jpeg"); assert.match(jpeg.cacheFileName, /\.jpg$/);
  });

  test("deletes cached images even when credentials are subsequently unavailable", async () => {
    const attachment = await paste(); key = undefined;
    await assert.rejects(controller.delete(attachment), /removed locally/); await assert.rejects(readFile(controller.getCacheUri(attachment.cacheFileName).fsPath), /ENOENT/);
    key = "restored"; await controller.delete(attachment); assert.equal(deleted.length, 1);
  });

  for (const remoteCleanupFails of [false, true]) {
    test(`preserves cache-write failures when remote cleanup ${remoteCleanupFails ? "fails" : "succeeds"}`, async () => {
      const upload = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (init?.method === "DELETE") {
          if (remoteCleanupFails) { throw new Error("remote cleanup failed"); }
          return upload(input, init);
        }
        const response = await upload(input, init);
        await rm(controller.cacheRoot.fsPath, { recursive: true });
        await writeFile(controller.cacheRoot.fsPath, "cache directory replaced by a file");
        return response;
      };
      await assert.rejects(paste(), /ENOTDIR/);
      assert.equal(await readFile(controller.cacheRoot.fsPath, "utf8"), "cache directory replaced by a file");
      if (!remoteCleanupFails) { assert.equal(deleted.length, 1); }
    });
  }

  test("rejects unsafe cache paths", () => {
    for (const name of ["", "../secret", "a/b", "a\\b", "a b"]) { assert.throws(() => controller.getCacheUri(name), /Invalid image cache/); }
  });

  test("archives real images and restores numbered or attachment-id previews without duplicating roots", async () => {
    await mkdir(path.join(root, "data", "history", "conversation-1"), { recursive: true });
    await writeFile(path.join(root, "data", "history", "conversation-1", "manifest.json"), "{}");
    const attachment = await paste(); await controller.archive("conversation-1", [attachment], webview);
    assert.equal(attachment.imageNumber, 1); assert.match(attachment.previewUri!, /screenshots/);
    const roots = webview.options.localResourceRoots!; assert.equal(roots.length, 1);
    attachment.previewUri = undefined; await controller.restorePreviews("conversation-1", [attachment], webview); assert.match(attachment.previewUri!, /^preview:/);
    attachment.imageNumber = undefined; await controller.restorePreviews("conversation-1", [attachment], webview); assert.equal(attachment.imageNumber, 1);
    assert.equal(webview.options.localResourceRoots!.length, 1);
    const missing = { ...attachment, id: "missing", imageNumber: undefined, previewUri: "unchanged" };
    await controller.restorePreviews("conversation-1", [missing], webview); assert.equal(missing.previewUri, "unchanged");
    await controller.restorePreviews("conversation-1", [], webview); await controller.archive("conversation-1", [], webview);
    await controller.archive("conversation-1", [attachment]); assert.equal(attachment.imageNumber, 1);
  });
});

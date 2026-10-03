import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ImageAttachment } from "@/contracts";
import { archiveConversationImages } from "@/infrastructure/images/ConversationImageArchive";
import { ScreenshotStore, SCREENSHOT_DIRECTORY_NAME } from "@/infrastructure/images/ScreenshotStore";

suite("conversation image archive", () => {
  let root: string;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const attachment: ImageAttachment = {
    id: "image-1", fileId: "file-api-test", name: "image.png", mediaType: "image/png",
    size: bytes.length, source: "clipboard", uploadedAt: 1, expiresAt: Date.now() + 60_000,
    apiBaseUrl: "https://api.deepseek.com", cacheFileName: "12345678-fb63-4a71-b87f-4867018152e2.png",
  };
  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "attachment-archive-"));
    await mkdir(path.join(root, "conversation-1"));
    await writeFile(path.join(root, "conversation-1", "manifest.json"), "{}");
  });
  teardown(async () => {await rm(root, { recursive: true, force: true });});
  test("stores attachments with incremental names, indexed metadata and lookup", async () => {
    await archiveConversationImages("conversation-1", [attachment], async () => bytes, root);
    await archiveConversationImages("conversation-1", [attachment], async () => bytes, root);
    const directory = path.join(root, "conversation-1", SCREENSHOT_DIRECTORY_NAME);
    assert.deepEqual(await readFile(path.join(directory, "1-image.png")), bytes);
    assert.deepEqual((await readdir(directory)).sort(), ["1-image.png", "index.json"]);
    const store = new ScreenshotStore("conversation-1", root);
    const restored = await store.lookup("screenshot-1");
    assert.equal(restored?.metadata.kind, "attachment");
    assert.equal(restored?.metadata.target, attachment.id);
    assert.equal(restored?.metadata.width, 1);
    assert.deepEqual(restored?.bytes, bytes);
    assert.deepEqual((await store.lookup(attachment.id))?.bytes, bytes);
  });
  test("refuses incomplete copies and corrupt images before indexing", async () => {
    await assert.rejects(archiveConversationImages("conversation-1", [attachment], async () => bytes.subarray(1), root), /Incomplete/);
    await assert.rejects(archiveConversationImages("conversation-1", [{ ...attachment, size: 11 }], async () => Buffer.from("not a photo"), root), /PNG or JPEG/);
    assert.equal(await new ScreenshotStore("conversation-1", root).lookup("latest"), undefined);
  });
  test("saving an agent capture preserves user images in the same screenshot directory", async () => {
    await archiveConversationImages("conversation-1", [attachment], async () => bytes, root);
    const store = new ScreenshotStore("conversation-1", root);
    await store.save(bytes, { kind: "web", target: "http://localhost:3000" });
    assert.deepEqual((await store.lookup("screenshot-1"))?.bytes, bytes);
    const index = JSON.parse(await readFile(path.join(store.directory, "index.json"), "utf8"));
    assert.deepEqual(index.items.map((item: { kind: string }) => item.kind), ["attachment", "web"]);
  });
  test("does not resurrect a deleted conversation", async () => {
    await rm(path.join(root, "conversation-1"), { recursive: true });
    await assert.rejects(archiveConversationImages("conversation-1", [attachment], async () => bytes, root));
    assert.deepEqual(await readdir(root), []);
  });
});

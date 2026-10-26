import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import * as path from "node:path";
import type { ImageAttachment } from "@/contracts";
import { archiveConversationImages } from "@/infrastructure/images/ConversationImageArchive";
import { ScreenshotStore, SCREENSHOT_DIRECTORY_NAME } from "@/infrastructure/images/ScreenshotStore";
import { resolveVisionImageSources } from "@/infrastructure/images/VisionImageSources";

suite("conversation image archive", () => {
  let root: string;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  function differentImage(value: number): Buffer {
    const pixels = inflateSync(bytes.subarray(41, 41 + bytes.readUInt32BE(33)));
    pixels[1] = value;
    const compressed = deflateSync(pixels);
    const chunk = Buffer.alloc(compressed.length + 12);
    chunk.writeUInt32BE(compressed.length);
    chunk.write("IDAT", 4);
    compressed.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    return Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(-12)]);
  }
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
  test("compares numbered historical images with a newly attached image in the same turn", async () => {
    const images = [1, 2, 3, 4].map((number) => ({ ...attachment, id: `attachment-${number}`, size: differentImage(number).length }));
    const readImage = async (image: ImageAttachment) => differentImage(Number(image.id.slice("attachment-".length)));
    await archiveConversationImages("conversation-1", images.slice(0, 3), readImage, root);
    await archiveConversationImages("conversation-1", [images[3]], readImage, root);
    assert.deepEqual(images.map((image) => image.imageNumber), [1, 2, 3, 4]);
    const store = new ScreenshotStore("conversation-1", root);
    assert.deepEqual((await store.list()).map((image) => image.id), ["screenshot-1", "screenshot-2", "screenshot-3", "screenshot-4"]);
    const resolved = await resolveVisionImageSources({ question: "Compare old and current state", screenshotIds: ["1", "3"], attachmentIds: [images[3].id] }, [images[3]], store);
    assert.deepEqual(resolved.local.map((image) => image.source), ["screenshot:screenshot-1", "screenshot:screenshot-3"]);
    assert.equal(resolved.attachments[0].imageNumber, 4);
    const restored = new ScreenshotStore("conversation-1", root);
    const all = await resolveVisionImageSources({ question: "Compare", screenshotIds: ["1", "3", "4"] }, [], restored);
    assert.deepEqual(all.local.map((image) => image.source), ["screenshot:screenshot-1", "screenshot:screenshot-3", "screenshot:screenshot-4"]);
    await assert.rejects(resolveVisionImageSources({ question: "Missing", screenshotIds: ["5"] }, [], restored), /not found/);
    await archiveConversationImages("conversation-1", [images[0]], readImage, root);
    assert.equal(images[0].imageNumber, 1);
    assert.equal((await store.list()).length, 4);
  });
  test("number aliases stay within the conversation and are not reassigned after eviction", async () => {
    const store = new ScreenshotStore("conversation-1", root, 1);
    await store.save(bytes, { kind: "attachment", target: "first" });
    await store.save(differentImage(2), { kind: "attachment", target: "second" });
    assert.equal(await store.lookup("1"), undefined);
    assert.equal((await store.lookup("2"))?.metadata.target, "second");
    await mkdir(path.join(root, "conversation-2"));
    await writeFile(path.join(root, "conversation-2", "manifest.json"), "{}");
    const other = new ScreenshotStore("conversation-2", root);
    await other.save(bytes, { kind: "attachment", target: "other" });
    assert.equal((await other.lookup("1"))?.metadata.target, "other");
    assert.equal(await other.lookup("2"), undefined);
  });
  test("deduplicates repeated bytes with different attachment ids and names, including concurrent sends", async () => {
    const first = { ...attachment, id: "first-upload" };
    const repeat = { ...attachment, id: "second-upload", name: "renamed.png" };
    await Promise.all([
      archiveConversationImages("conversation-1", [first], async () => bytes, root),
      archiveConversationImages("conversation-1", [repeat], async () => bytes, root),
    ]);
    assert.equal(first.imageNumber, 1);
    assert.equal(repeat.imageNumber, 1);
    const store = new ScreenshotStore("conversation-1", root);
    const entries = await store.list();
    assert.equal(entries.length, 1);
    assert.deepEqual((await readdir(store.directory)).sort(), [entries[0].fileName, "index.json"].sort());
    assert.deepEqual((await new ScreenshotStore("conversation-1", root).lookup(String(repeat.imageNumber)))?.bytes, bytes);
    const different = await store.save(differentImage(3), { kind: "attachment", target: "new-image" });
    assert.equal(different.id, "screenshot-2");
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

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { inspectCapture } from "@/infrastructure/images/ImageFormat";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==", "base64");
suite("screenshot storage", () => {
  let root: string;
  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "screenshots-"));
    await mkdir(path.join(root, "conversation-1"));
    await writeFile(path.join(root, "conversation-1", "manifest.json"), "{}");
  });
  teardown(async () => {await rm(root, { recursive: true, force: true });});
  test("atomic writes, deduplication and lookup survive a new store instance", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    const first = await store.save(png, { kind: "web", target: "http://localhost:3000", label: "../page" });
    const duplicate = await store.save(png, { kind: "web", target: "http://localhost:3000" });
    assert.equal(first.id, duplicate.id);
    const restored = await new ScreenshotStore("conversation-1", root).lookup("latest");
    assert.deepEqual(restored?.bytes, png);
    assert.equal(restored?.metadata.width, 1);
    assert.equal(restored?.metadata.height, 1);
    assert.equal((await readdir(store.directory)).filter((name) => name.endsWith(".tmp")).length, 0);
  });
  test("retention evicts least recently accessed captures and removes their files", async () => {
    const store = new ScreenshotStore("conversation-1", root, 2);
    const first = await store.save(png, { kind: "web", target: "one" });
    await store.save(png, { kind: "web", target: "two" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.lookup(first.id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.save(png, { kind: "web", target: "three" });
    assert.ok(await store.lookup(first.id));
    assert.equal(await store.lookup("screenshot-2"), undefined);
    assert.equal((await readdir(store.directory)).length, 3);
  });
  test("corrupt/truncated bytes and oversized captures never enter the index", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    await assert.rejects(store.save(png.subarray(0, 35), { kind: "window", target: "app" }), /PNG/);
    const corrupt = Buffer.from(png); corrupt[40] ^= 1;
    assert.throws(() => inspectCapture(corrupt), /PNG/);
    await assert.rejects(new ScreenshotStore("conversation-1", root, 40, 10).save(png, { kind: "web", target: "app" }), /size limit/);
  });
  test("JPEG magic determines its extension and incomplete JPEG headers are rejected", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    const saved = await store.save(jpeg, { kind: "window", target: "app", label: "jpeg", windowTitle: "Application", pid: 123 });
    assert.equal(saved.fileName, "1-jpeg.jpg");
    const restored = await new ScreenshotStore("conversation-1", root).lookup(saved.id);
    assert.deepEqual(restored?.bytes, jpeg);
    assert.equal(restored?.metadata.windowTitle, "Application");
    assert.equal(restored?.metadata.pid, 123);
    assert.equal(restored?.metadata.width, 1);
    assert.equal(restored?.metadata.height, 1);
    await assert.rejects(store.save(jpeg.subarray(0, -2), { kind: "window", target: "truncated" }), /PNG or JPEG/);
    const scan = jpeg.indexOf(Buffer.from([255, 218]));
    const headersOnly = Buffer.concat([jpeg.subarray(0, scan), Buffer.from([255, 217])]);
    await assert.rejects(store.save(headersOnly, { kind: "window", target: "no-pixels" }), /PNG or JPEG/);
  });
  test("concurrent stores allocate distinct incremental ids", async () => {
    const results = await Promise.all([1, 2, 3].map((number) => new ScreenshotStore("conversation-1", root).save(png, { kind: "web", target: String(number) })));
    assert.equal(new Set(results.map((item) => item.id)).size, 3);
    const index = JSON.parse(await readFile(path.join(root, "conversation-1", ".screenshots", "index.json"), "utf8"));
    assert.equal(index.next, 4);
  });
  test("automatic capture accounting survives retention and duplicates do not consume its cap", async () => {
    const store = new ScreenshotStore("conversation-1", root, 1);
    await store.save(png, { kind: "web", target: "one", automatic: true, automaticLimit: 2 });
    await store.save(png, { kind: "web", target: "one", automatic: true, automaticLimit: 2 });
    assert.equal(await store.automaticCount(), 1);
    await store.save(png, { kind: "web", target: "two", automatic: true, automaticLimit: 2 });
    assert.equal(await new ScreenshotStore("conversation-1", root).automaticCount(), 2);
    await assert.rejects(store.save(png, { kind: "web", target: "three", automatic: true, automaticLimit: 2 }), /limit/);
  });
  test("deleted conversations cannot be recreated by a late capture", async () => {
    await rm(path.join(root, "conversation-1"), { recursive: true });
    await assert.rejects(new ScreenshotStore("conversation-1", root).save(png, { kind: "web", target: "app" }));
    assert.throws(() => new ScreenshotStore("../outside", root), /Invalid/);
  });
  test("byte retention evicts files even below the count limit", async () => {
    const store = new ScreenshotStore("conversation-1", root, 40, png.length * 2);
    await store.save(png, { kind: "attachment", target: "one" });
    await store.save(png, { kind: "web", target: "two" });
    await store.save(png, { kind: "window", target: "three" });
    assert.equal(await store.lookup("screenshot-1"), undefined);
    const index = JSON.parse(await readFile(path.join(store.directory, "index.json"), "utf8"));
    assert.equal(index.items.length, 2);
    assert.ok(index.items.reduce((total: number, item: { bytes: number }) => total + item.bytes, 0) <= png.length * 2);
    assert.equal((await readdir(store.directory)).length, 3);
  });
  test("latest uses sequence order when captures share a timestamp", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    await store.save(png, { kind: "web", target: "one" });
    const last = await store.save(png, { kind: "window", target: "two" });
    const indexPath = path.join(store.directory, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    for (const item of index.items) {item.createdAt = 123;}
    await writeFile(indexPath, JSON.stringify(index));
    assert.equal((await store.lookup("latest"))?.metadata.id, last.id);
  });
  test("an index write failure leaves the previous index and capture intact", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    const first = await store.save(png, { kind: "web", target: "one" });
    const indexPath = path.join(store.directory, "index.json");
    const originalIndex = await readFile(indexPath);
    Reflect.set(store, "writeIndex", async () => {throw new Error("Simulated disk failure");});
    await assert.rejects(store.save(png, { kind: "web", target: "two" }), /disk failure/);
    assert.deepEqual(await readFile(indexPath), originalIndex);
    const restored = new ScreenshotStore("conversation-1", root);
    assert.deepEqual((await restored.lookup(first.id))?.bytes, png);
    assert.deepEqual((await readdir(store.directory)).sort(), [first.fileName, "index.json"]);
  });
  test("corrupt file lookup is rejected and a corrupt index never discards history", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    const first = await store.save(png, { kind: "window", target: "app", windowTitle: "Test", pid: 123 });
    const corrupt = Buffer.from(png); corrupt[40] ^= 1;
    await writeFile(path.join(store.directory, first.fileName), corrupt);
    assert.equal(await store.lookup(first.id), undefined);
    await writeFile(path.join(store.directory, "index.json"), "{broken");
    await assert.rejects(store.lookup("latest"));
    assert.equal(await readFile(path.join(root, "conversation-1", "manifest.json"), "utf8"), "{}");
  });
  test("an interrupted write is cleaned up and cannot reset the filename sequence", async () => {
    const store = new ScreenshotStore("conversation-1", root);
    await mkdir(store.directory);
    await writeFile(path.join(store.directory, "7-orphan.png"), png);
    await writeFile(path.join(store.directory, ".interrupted.tmp"), png);
    const saved = await store.save(png, { kind: "web", target: "app" });
    assert.equal(saved.id, "screenshot-8");
    assert.deepEqual((await readdir(store.directory)).sort(), [saved.fileName, "index.json"]);
  });
});

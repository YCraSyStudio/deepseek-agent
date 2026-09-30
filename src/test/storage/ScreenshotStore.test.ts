import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { inspectCapture } from "@/infrastructure/images/ImageFormat";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
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
  test("concurrent stores allocate distinct incremental ids", async () => {
    const results = await Promise.all([1, 2, 3].map((number) => new ScreenshotStore("conversation-1", root).save(png, { kind: "web", target: String(number) })));
    assert.equal(new Set(results.map((item) => item.id)).size, 3);
    const index = JSON.parse(await readFile(path.join(root, "conversation-1", ".screenshots", "index.json"), "utf8"));
    assert.equal(index.next, 4);
  });
  test("deleted conversations cannot be recreated by a late capture", async () => {
    await rm(path.join(root, "conversation-1"), { recursive: true });
    await assert.rejects(new ScreenshotStore("conversation-1", root).save(png, { kind: "web", target: "app" }));
    assert.throws(() => new ScreenshotStore("../outside", root), /Invalid/);
  });
});

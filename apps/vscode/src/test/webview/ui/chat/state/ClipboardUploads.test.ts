import assert from "node:assert/strict";
import { ClipboardUploads } from "@webview/views/chatView/model/ClipboardUploads";
import type { ImageAttachment } from "@/contracts";

suite("clipboard upload previews", () => {
  test("previews appear before completion and resolve by id out of order", () => {
    const revoked: string[] = [];
    const uploads = new ClipboardUploads((uri) => revoked.push(uri));
    uploads.add({ requestId: "one", name: "one.png", previewUri: "blob:one" });
    uploads.add({ requestId: "two", name: "two.png", previewUri: "blob:two" });
    assert.equal(uploads.previews().length, 2);
    assert.deepEqual(uploads.complete("two", [image("two")]).accepted.map((item) => item.id), ["two"]);
    assert.deepEqual(uploads.previews().map((item) => item.requestId), ["one"]);
    uploads.complete("one", []);
    assert.deepEqual(revoked, ["blob:two", "blob:one"]);
  });
  test("removed and navigated-away uploads cannot reappear in a new composer", async () => {
    const revoked: string[] = [];
    const old = new ClipboardUploads((uri) => revoked.push(uri));
    old.add({ requestId: "removed", name: "a.png", previewUri: "blob:a" });
    const submission = old.uploadSelected(async () => undefined);
    const rejected = assert.rejects(submission, /cancelled/);
    old.dispose();
    const next = new ClipboardUploads(() => undefined);
    assert.deepEqual(next.complete("removed", [image("remote")]).accepted, []);
    const result = old.complete("removed", [image("remote")]);
    assert.deepEqual(result.accepted, []);
    assert.deepEqual(result.discarded.map((item) => item.id), ["remote"]);
    assert.equal(old.outstanding, 0);
    assert.deepEqual(revoked, ["blob:a"]);
    await rejected;
  });
  test("local images remain idle until submission and can be removed without an upload", async () => {
    const uploads = new ClipboardUploads(() => undefined);
    uploads.add({ requestId: "local", name: "local.png", previewUri: "blob:local" });
    uploads.remove("local");
    assert.equal(uploads.outstanding, 0);
    let calls = 0;
    assert.deepEqual(await uploads.uploadSelected(async () => {calls++;}), []);
    assert.equal(calls, 0);
  });
  test("submission waits for uploads and preserves failed local images for retry", async () => {
    const revoked: string[] = [];
    const uploads = new ClipboardUploads((uri) => revoked.push(uri));
    uploads.add({ requestId: "retry", name: "retry.png", previewUri: "blob:retry" });
    await assert.rejects(uploads.uploadSelected(async () => {throw new Error("network failed");}), /network failed/);
    assert.equal(uploads.previews()[0].requestId, "retry");
    assert.deepEqual(revoked, []);
    const result = await uploads.uploadSelected(async (preview) => {
      uploads.complete(preview.requestId, [image("remote")]);
    });
    assert.deepEqual(result.map((item) => item.id), ["remote"]);
    assert.deepEqual(revoked, ["blob:retry"]);
  });
});
function image(id: string): ImageAttachment {return { id, source: "clipboard" } as ImageAttachment;}

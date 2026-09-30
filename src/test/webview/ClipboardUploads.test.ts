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
  test("removed and navigated-away uploads cannot reappear in a new composer", () => {
    const revoked: string[] = [];
    const old = new ClipboardUploads((uri) => revoked.push(uri));
    old.add({ requestId: "removed", name: "a.png", previewUri: "blob:a" });
    old.dispose();
    const next = new ClipboardUploads(() => undefined);
    const result = next.complete("removed", [image("remote")]);
    assert.equal(result.handled, true);
    assert.deepEqual(result.accepted, []);
    assert.deepEqual(result.discarded.map((item) => item.id), ["remote"]);
    assert.equal(old.outstanding, 0);
    assert.deepEqual(revoked, ["blob:a"]);
  });
});
function image(id: string): ImageAttachment {return { id } as ImageAttachment;}

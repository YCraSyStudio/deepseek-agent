import assert from "node:assert/strict";
import type { ImageAttachment, ReferencedFile } from "@/contracts";
import { clearSubmittedDraft } from "@webview/views/chatView/hooks/UseChatCommandMessages";

type Refs = Parameters<typeof clearSubmittedDraft>[1];
type Setters = Parameters<typeof clearSubmittedDraft>[2];
function fixture() {
  let text = "sent text";
  let images = [{ id: "sent" }, { id: "new" }] as ImageAttachment[];
  let references = [{ path: "sent.ts" }, { path: "new.ts" }] as ReferencedFile[];
  const refs = { draft: { current: text }, imageAttachments: { current: images }, referencedFiles: { current: references },
    pendingRequests: { current: new Map([["request", { text, imageIds: ["sent"], referenceIds: ["workspace:sent.ts"] }]]) } } as Refs;
  const setters = {
    setDraft: (update: (current: string) => string) => {text = update(text);},
    setImageAttachments: (update: (current: ImageAttachment[]) => ImageAttachment[]) => {images = update(images);},
    setReferencedFiles: (update: (current: ReferencedFile[]) => ReferencedFile[]) => {references = update(references);},
  } as Setters;
  return { refs, setters, edit: (value: string) => {text = value;}, state: () => ({ text, images, references }) };
}
suite("submitted chat draft", () => {
  test("clears sent text and attachments while preserving attachments added later", () => {
    const { refs, setters, state } = fixture();
    clearSubmittedDraft("request", refs, setters);
    assert.equal(state().text, "");
    assert.deepEqual(state().images.map(image => image.id), ["new"]);
    assert.deepEqual(state().references.map(file => file.path), ["new.ts"]);
    assert.equal(refs.pendingRequests.current.size, 0);
    assert.deepEqual(refs.imageAttachments.current, state().images);
  });
  test("preserves text edited before acknowledgement and tolerates repeated acknowledgement", () => {
    const { refs, setters, edit, state } = fixture();
    edit("next message");
    refs.draft.current = "next message";
    clearSubmittedDraft("request", refs, setters);
    assert.equal(state().text, "next message");
    clearSubmittedDraft("request", refs, setters);
    assert.deepEqual(state().images.map(image => image.id), ["new"]);
  });
  test("filters images even when upload state has not yet reached the ref", () => {
    const { refs, setters, state } = fixture();
    refs.imageAttachments.current = [];
    clearSubmittedDraft("request", refs, setters);
    assert.deepEqual(state().images.map(image => image.id), ["new"]);
  });
});

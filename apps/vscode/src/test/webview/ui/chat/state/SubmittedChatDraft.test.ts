import assert from "node:assert/strict";
import type { ImageAttachment, ReferencedFile } from "@/contracts";
import { clearSubmittedDraft, submitChatDraft, restoreRejectedDraft } from "@webview/views/chatView/hooks/UseChatCommandMessages";

type Refs = Parameters<typeof clearSubmittedDraft>[1];
type Setters = Parameters<typeof clearSubmittedDraft>[2];
function fixture() {
  let text = "sent text";
  let images = [{ id: "sent" }, { id: "new" }] as ImageAttachment[];
  let references = [{ path: "sent.ts" }, { path: "new.ts" }] as ReferencedFile[];
  const refs = { draft: { current: text }, imageAttachments: { current: images }, referencedFiles: { current: references },
    pendingRequests: { current: new Map([["request", { text, imageIds: ["sent"], referenceIds: ["workspace:sent.ts"] }]]) } } as Refs;
  const setters = {
    setDraft: (update: string | ((current: string) => string)) => {text = typeof update === "function" ? update(text) : update;},
    setImageAttachments: (update: ImageAttachment[] | ((current: ImageAttachment[]) => ImageAttachment[])) => {images = typeof update === "function" ? update(images) : update;},
    setReferencedFiles: (update: ReferencedFile[] | ((current: ReferencedFile[]) => ReferencedFile[])) => {references = typeof update === "function" ? update(references) : update;},
  } as Setters;
  return { refs, setters, edit: (value: string) => {text = value;}, state: () => ({ text, images, references }) };
}
suite("submitted chat draft", () => {
  test("clears immediately without waiting for acknowledgement and preserves an identical next draft", () => {
    const { refs, setters, state, edit } = fixture();
    submitChatDraft("request", refs, setters);
    assert.equal(state().text, "");
    assert.deepEqual(state().images.map(image => image.id), ["new"]);
    assert.equal(refs.pendingRequests.current.size, 1);
    edit("sent text"); refs.draft.current = "sent text";
    clearSubmittedDraft("request", refs, setters);
    assert.equal(state().text, "sent text");
    assert.equal(refs.pendingRequests.current.size, 0);
  });
  test("rejected dispatch restores the payload when the composer is empty", () => {
    const { refs, setters, state } = fixture();
    const request = refs.pendingRequests.current.get("request")!;
    request.images = [state().images[0]]; request.references = [state().references[0]];
    request.imageIds = state().images.map(image => image.id);
    request.referenceIds = ["workspace:sent.ts", "workspace:new.ts"];
    submitChatDraft("request", refs, setters);
    restoreRejectedDraft("request", refs, setters);
    assert.equal(state().text, "sent text");
    assert.deepEqual(state().images.map(image => image.id), ["sent"]);
    assert.deepEqual(state().references.map(file => file.path), ["sent.ts"]);
  });
  test("rejected dispatch keeps later edits and offers the failed message as a recovered draft", () => {
    const { refs, setters, edit, state } = fixture();
    submitChatDraft("request", refs, setters);
    edit("next message"); refs.draft.current = "next message";
    let recovered: Array<{ text: string }> = [];
    setters.setRecoveredDrafts = update => {recovered = typeof update === "function" ? update([]) : update;};
    restoreRejectedDraft("request", refs, setters);
    assert.equal(state().text, "next message");
    assert.equal(recovered[0].text, "sent text");
  });
  test("clears sent text and attachments while preserving attachments added later", () => {
    const { refs, setters, state } = fixture();
    assert.equal(clearSubmittedDraft("request", refs, setters), true);
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
    assert.equal(clearSubmittedDraft("request", refs, setters), false);
    assert.deepEqual(state().images.map(image => image.id), ["new"]);
  });
  test("filters images even when upload state has not yet reached the ref", () => {
    const { refs, setters, state } = fixture();
    refs.imageAttachments.current = [];
    clearSubmittedDraft("request", refs, setters);
    assert.deepEqual(state().images.map(image => image.id), ["new"]);
  });
});

import assert from "node:assert/strict";
import { mock } from "node:test";
import { readChatDraft, writeChatDraftMetadata, draftAttachmentsOperation } from "@webview/views/chatView/model/DraftAttachmentsStore";

suite("host-backed draft attachment requests", () => {
  let previous: PropertyDescriptor | undefined;
  let receivers: Set<(event: { data: unknown }) => void>;
  let posts: Array<Record<string, unknown>>; let response: Record<string, unknown>; let hold: boolean;
  let host: { addEventListener?: (type: string, listener: (event: { data: unknown }) => void) => void; removeEventListener: (type: string, listener: (event: { data: unknown }) => void) => void; acquireVsCodeApi?: () => unknown };
  const reply = (data: unknown) => { for (const receive of receivers) { receive({ data }); } };
  const draft = { draft: "Prepared text", referencedFiles: [], imageAttachments: [] };
  setup(() => {
    previous = Object.getOwnPropertyDescriptor(globalThis, "window"); receivers = new Set(); posts = []; response = {}; hold = false;
    host = {
      addEventListener: (_type, listener) => { receivers.add(listener); },
      removeEventListener: (_type, listener) => { receivers.delete(listener); },
      acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => {
        posts.push(message);
        if (!hold) { queueMicrotask(() => reply({ type: "chatDraftResult", requestId: message.requestId, ...response })); }
      } }),
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: host });
  });
  teardown(() => {
    mock.timers.reset();
    if (previous) { Object.defineProperty(globalThis, "window", previous); } else { Reflect.deleteProperty(globalThis, "window"); }
  });
  test("rejects storage requests without a host API", async () => {
    delete host.acquireVsCodeApi;
    await assert.rejects(readChatDraft(), /Draft storage is unavailable/); assert.equal(posts.length, 0);
  });
  test("serializes writes and deletes and ignores unrelated response messages", async () => {
    hold = true;
    const first = writeChatDraftMetadata("chat", draft);
    const second = draftAttachmentsOperation("chat", "delete");
    for (let i = 0; i < 10 && posts.length === 0; i++) { await Promise.resolve(); }
    assert.equal(posts.length, 1); assert.equal(posts[0].operation, "write");
    reply({ type: "unrelated", requestId: posts[0].requestId });
    reply({ type: "chatDraftResult", requestId: "stale" });
    assert.equal(receivers.size, 1); assert.equal(posts.length, 1);
    reply({ type: "chatDraftResult", requestId: posts[0].requestId }); await first;
    for (let i = 0; i < 10 && posts.length < 2; i++) { await Promise.resolve(); }
    assert.equal(posts[1].operation, "delete");
    reply({ type: "chatDraftResult", requestId: posts[1].requestId }); await second;
    assert.equal(receivers.size, 0);
  });
  test("encodes binary files once and reuses their data in subsequent saves", async () => {
    const bytes = Uint8Array.from({ length: 40000 }, (_, i) => i % 256);
    const file = new File([bytes], "image.png", { type: "image/png" }); let reads = 0;
    const read = file.arrayBuffer.bind(file); Object.defineProperty(file, "arrayBuffer", { value: () => { reads++; return read(); } });
    const references = [{ path: "file.ts", type: "file" as const, content: "Reference" }];
    await draftAttachmentsOperation("chat", "write", { images: [{ name: "image.png", file }], references });
    await draftAttachmentsOperation("chat", "write", { images: [{ name: "image.png", file }], references });
    assert.equal(reads, 1);
    for (const post of posts) {
      const attachments = post.attachments as { images: Array<{ name: string; mediaType: string; dataBase64: string }>; references: unknown[] };
      assert.equal(attachments.images[0].name, "image.png"); assert.equal(attachments.images[0].mediaType, "image/png");
      assert.deepEqual(Buffer.from(attachments.images[0].dataBase64, "base64"), Buffer.from(bytes));
      assert.deepEqual(attachments.references, references);
    }
    await draftAttachmentsOperation(undefined, "write");
    assert.deepEqual(posts[2].attachments, { images: [], references: [] });
  });
  test("restores metadata, references and binary files returned by the host", async () => {
    response = { draft, attachments: { references: [{ path: "a.ts", type: "file", content: "A" }], images: [{ name: "saved.png", mediaType: "image/png", dataBase64: "AAH/" }] } };
    const value = await readChatDraft("chat");
    assert.deepEqual(value.draft, draft); assert.deepEqual(value.attachments?.references, (response.attachments as { references: unknown }).references);
    const image = value.attachments!.images[0]; assert.equal(image.file.type, "image/png"); assert.equal(image.name, "saved.png");
    assert.deepEqual(new Uint8Array(await image.file.arrayBuffer()), Uint8Array.from([0, 1, 255]));
  });
  test("recovers its queue after host errors and rejects a host without message listeners", async () => {
    response = { error: "Draft disk failed" }; await assert.rejects(writeChatDraftMetadata("chat", draft), /Draft disk failed/);
    response = {}; await writeChatDraftMetadata("chat", draft); assert.equal(receivers.size, 0);
    host.addEventListener = undefined; await assert.rejects(readChatDraft("chat"), /Draft storage is unavailable/);
  });
  test("cleans up timed-out requests and allows subsequent operations", async () => {
    hold = true; mock.timers.enable({ apis: ["setTimeout"] });
    const pending = readChatDraft("chat"); const rejected = assert.rejects(pending, /Draft storage timed out/);
    for (let i = 0; i < 10 && posts.length === 0; i++) { await Promise.resolve(); }
    assert.equal(posts.length, 1); mock.timers.tick(30000); await rejected;
    assert.equal(receivers.size, 0); mock.timers.reset(); hold = false;
    assert.deepEqual(await readChatDraft("chat"), { draft: undefined, attachments: undefined });
  });
});

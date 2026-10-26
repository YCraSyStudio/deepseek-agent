import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ChatDraftStore } from "@/infrastructure/persistence/ChatDraftStore";
import { readStoredConversationRecord } from "@/vscode/storage/ConversationStorage";

suite("native chat draft storage", () => {
  let root: string;
  let store: ChatDraftStore;
  setup(async () => {root = await mkdtemp(path.join(tmpdir(), "deepseek-native-drafts-"));store = new ChatDraftStore(root);});
  teardown(async () => {await rm(root, { recursive: true, force: true });});
  const draft = (text: string) => ({ draft: text, referencedFiles: [], imageAttachments: [] });
  const request = (operation: "read" | "write" | "delete", conversationId?: string) => ({ type: "chatDraft" as const, requestId: "test", operation, conversationId });
  test("stores new and existing drafts with real binary attachments and restores after reopening", async () => {
    await store.handle({ ...request("write"), draft: draft("hola"), attachments: {
      images: [{ name: "paste.png", mediaType: "image/png", dataBase64: Buffer.from("original image bytes").toString("base64") }], references: [] } });
    await store.handle({ ...request("write", "chat-one"), draft: draft("uno") });
    assert.equal(JSON.parse(await readFile(path.join(root, "new-chat-draft/draft.json"), "utf8")).draft.draft, "hola");
    assert.equal(JSON.parse(await readFile(path.join(root, "chat-one/draft/draft.json"), "utf8")).draft.draft, "uno");
    const reopened = new ChatDraftStore(root);
    const result = await reopened.handle(request("read"));
    assert.equal(result.draft?.draft, "hola");
    assert.equal(Buffer.from(result.attachments!.images[0].dataBase64, "base64").toString(), "original image bytes");
    const files = await readdir(path.join(root, "new-chat-draft"));
    assert.equal(files.filter(file => file.endsWith(".bin")).length, 1);
    await store.handle({ ...request("write"), draft: draft("hola editado") });
    assert.deepEqual(await readdir(path.join(root, "new-chat-draft")), files);
    await store.handle(request("delete"));
    assert.equal((await reopened.handle(request("read"))).draft, undefined);
    assert.equal((await reopened.handle(request("read", "chat-one"))).draft?.draft, "uno");
  });
  test("removes empty drafts and does not mistake draft-only folders for broken conversations", async () => {
    await store.handle({ ...request("write", "chat-one"), draft: draft("pending") });
    assert.equal(await readStoredConversationRecord(path.join(root, "chat-one")), undefined);
    assert.equal((await store.handle(request("read", "chat-one"))).draft?.draft, "pending");
    await store.handle({ ...request("write", "chat-one"), draft: draft("") });
    assert.equal((await store.handle(request("read", "chat-one"))).draft, undefined);
  });
  test("rejects traversal, reserved IDs and symlinked storage", async () => {
    for (const id of ["../outside", ".", "new-chat-draft", "a/b"]) {
      await assert.rejects(store.handle({ ...request("write", id), draft: draft("bad") }), /Invalid/);
    }
    const outside = path.join(root, "outside");await mkdir(outside);
    await symlink(outside, path.join(root, "new-chat-draft"));
    await assert.rejects(store.handle({ ...request("write"), draft: draft("bad") }), /symlink/);
    assert.deepEqual(await readdir(outside), []);
  });
});

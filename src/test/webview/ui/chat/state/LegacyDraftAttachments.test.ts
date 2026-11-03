import assert from "node:assert/strict";
import { draftAttachmentsOperation } from "@webview/views/chatView/model/LegacyDraftAttachments";

type Request = { result: unknown; error?: Error; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void };
type Transaction = { error?: Error; oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore(name: string): { get(key: string): { result: unknown }; delete(key: string): { result: undefined } } };

suite("legacy attachment database lifecycle", () => {
  let original: PropertyDescriptor | undefined; let entries: Map<string, unknown>;
  let opens: number; let closed: number; let created: string[]; let modes: string[];
  let failOpen: boolean; let failure: "abort" | "error" | undefined; let transactionError: Error | undefined;
  let database: { onversionchange?: () => void; close(): void; createObjectStore(name: string): void; transaction(name: string, mode: string): Transaction };
  setup(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"); entries = new Map(); opens = 0; closed = 0; created = []; modes = []; failOpen = false; failure = undefined; transactionError = undefined;
    database = { close() { closed++; }, createObjectStore(name) { created.push(name); }, transaction(name, mode) {
      assert.equal(name, "drafts"); modes.push(mode);
      const transaction: Transaction = { error: transactionError, objectStore(store) {
        assert.equal(store, "drafts"); return { get: key => ({ result: entries.get(key) }), delete: key => { entries.delete(key); return { result: undefined }; } };
      } };
      queueMicrotask(() => { if (failure === "abort") { transaction.onabort?.(); } else if (failure === "error") { transaction.onerror?.(); } else { transaction.oncomplete?.(); } });
      return transaction;
    } };
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open(name: string, version: number) {
      assert.equal(name, "ycrasy-chat-draft-attachments"); assert.equal(version, 1); opens++;
      const request: Request = { result: database, error: new Error("Database unavailable") };
      queueMicrotask(() => { if (failOpen) { request.onerror?.(); } else { request.onupgradeneeded?.(); request.onsuccess?.(); } });
      return request;
    } } });
  });
  teardown(() => {
    database.onversionchange?.();
    if (original) { Object.defineProperty(globalThis, "indexedDB", original); } else { Reflect.deleteProperty(globalThis, "indexedDB"); }
  });
  test("serializes reads and deletion through one cached database connection", async () => {
    const stored = { images: [], references: [{ path: "a.ts", name: "a.ts", type: "file" }] }; entries.set("draft", stored);
    const results = await Promise.all([draftAttachmentsOperation("draft", "read"), draftAttachmentsOperation("draft", "delete"), draftAttachmentsOperation("draft", "read")]);
    assert.deepEqual(results, [stored, undefined, undefined]); assert.equal(opens, 1); assert.deepEqual(created, ["drafts"]);
    assert.deepEqual(modes, ["readonly", "readwrite", "readonly"]); assert.equal(entries.has("draft"), false);
  });
  test("allows another operation to retry after database opening fails", async () => {
    failOpen = true; await assert.rejects(draftAttachmentsOperation("draft", "read"), /Database unavailable/);
    failOpen = false; entries.set("draft", { images: [], references: [] });
    assert.deepEqual(await draftAttachmentsOperation("draft", "read"), { images: [], references: [] }); assert.equal(opens, 2);
  });
  for (const event of ["abort", "error"] as const) {
    test(`reports transaction ${event} and lets later reads proceed`, async () => {
      failure = event; transactionError = new Error("Storage transaction failed");
      await assert.rejects(draftAttachmentsOperation("draft", "read"), /Storage transaction failed/);
      failure = undefined; assert.equal(await draftAttachmentsOperation("draft", "read"), undefined); assert.equal(opens, 1);
    });
  }
  test("supplies a fallback transaction error and reconnects after a version change", async () => {
    failure = "abort"; await assert.rejects(draftAttachmentsOperation("draft", "read"), /Could not save draft attachments/);
    failure = undefined; database.onversionchange!(); assert.equal(closed, 1);
    assert.equal(await draftAttachmentsOperation("draft", "read"), undefined); assert.equal(opens, 2);
  });
});

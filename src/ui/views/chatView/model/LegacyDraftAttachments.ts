import type { ReferencedFile } from "@/contracts";

export interface StoredDraftAttachments {
  images: Array<{ name: string; file: File }>;
  references: ReferencedFile[];
}

// Read old IndexedDB drafts once and remove each entry after native migration.
let database: Promise<IDBDatabase> | undefined;
let pending: Promise<unknown> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("ycrasy-chat-draft-attachments", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => {database = undefined; reject(request.error);};
    request.onsuccess = () => {
      request.result.onversionchange = () => {request.result.close(); database = undefined;};
      resolve(request.result);
    };
  });
}

export function draftAttachmentsOperation(
  key: string, operation: "read" | "delete",
): Promise<StoredDraftAttachments | undefined> {
  const run = pending.catch(() => undefined).then(async () => {
    const db = await openDatabase();
    return new Promise<StoredDraftAttachments | undefined>((resolve, reject) => {
      const transaction = db.transaction("drafts", operation === "read" ? "readonly" : "readwrite");
      const store = transaction.objectStore("drafts");
      const request = operation === "read" ? store.get(key) : store.delete(key);
      transaction.oncomplete = () => resolve(operation === "read" ? request.result as StoredDraftAttachments | undefined : undefined);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Could not save draft attachments."));
    });
  });
  pending = run;
  return run;
}

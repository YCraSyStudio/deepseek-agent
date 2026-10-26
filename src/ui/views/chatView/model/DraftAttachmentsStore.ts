import { getVsCodeApi } from "@webview/VsCodeApi";
import type { ChatDraftData, ChatDraftRequest, ChatDraftResult, DraftImageData } from "@/contracts/ChatDraft";
import type { ReferencedFile } from "@/contracts";

export interface StoredDraftAttachments { images: Array<{ name: string; file: File }>; references: ReferencedFile[] }
let pending: Promise<unknown> = Promise.resolve();
const encodedImages = new WeakMap<File, Promise<DraftImageData>>();

function request(message: Omit<ChatDraftRequest, "type" | "requestId">): Promise<ChatDraftResult> {
  return new Promise<ChatDraftResult>((resolve, reject) => {
    const api = getVsCodeApi();
    if (!api || typeof window.addEventListener !== "function") {reject(new Error("Draft storage is unavailable."));return;}
    const requestId = crypto.randomUUID();
    const cleanup = () => {clearTimeout(timeout);window.removeEventListener("message", receive);};
    const receive = (event: MessageEvent<ChatDraftResult>) => {
      if (event.data.type !== "chatDraftResult" || event.data.requestId !== requestId) {return;}
      cleanup();
      if (event.data.error) {reject(new Error(event.data.error));} else {resolve(event.data);}
    };
    const timeout = setTimeout(() => {cleanup();reject(new Error("Draft storage timed out."));}, 30_000);
    window.addEventListener("message", receive);
    api.postMessage({ type: "chatDraft", requestId, ...message });
  });
}
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = pending.catch(() => undefined).then(operation);
  pending = run;
  return run;
}
export async function readChatDraft(conversationId?: string): Promise<{ draft?: ChatDraftData; attachments?: StoredDraftAttachments }> {
  return enqueue(async () => {
  const result = await request({ operation: "read", conversationId });
  return { draft: result.draft, attachments: result.attachments ? {
    references: result.attachments.references,
    images: result.attachments.images.map(image => ({ name: image.name,
      file: new File([Uint8Array.from(atob(image.dataBase64), character => character.charCodeAt(0))], image.name, { type: image.mediaType }) })),
  } : undefined };
  });
}
export async function writeChatDraftMetadata(conversationId: string | undefined, draft: ChatDraftData): Promise<void> {
  await enqueue(() => request({ operation: "write", conversationId, draft }));
}
export async function draftAttachmentsOperation(
  conversationId: string | undefined, operation: "write" | "delete", value?: StoredDraftAttachments,
): Promise<void> {
  await enqueue(async () => {
  if (operation === "delete") {await request({ operation: "delete", conversationId });return;}
  const images = await Promise.all((value?.images ?? []).map(({ name, file }) => {
    let encoded = encodedImages.get(file);
    if (!encoded) {
      encoded = file.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer); const chunks: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));}
        return { name, mediaType: file.type, dataBase64: btoa(chunks.join("")) };
      });
      encodedImages.set(file, encoded);
    }
    return encoded;
  }));
  await request({ operation: "write", conversationId, attachments: { images, references: value?.references ?? [] } });
  });
}

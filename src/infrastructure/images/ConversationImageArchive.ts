import type { ImageAttachment } from "@/contracts";
import { getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { ScreenshotStore, type ScreenshotMetadata } from "./ScreenshotStore";

export async function archiveConversationImages(
  conversationId: string,
  attachments: readonly ImageAttachment[],
  readCachedImage: (attachment: ImageAttachment) => Promise<Uint8Array>,
  historyRoot = getHistoryDirectory(),
): Promise<ScreenshotMetadata[]> {
  if (attachments.length === 0) {return [];}
  const store = new ScreenshotStore(conversationId, historyRoot);
  const captures: ScreenshotMetadata[] = [];
  for (const attachment of attachments) {
    const bytes = await readCachedImage(attachment);
    if (bytes.length !== attachment.size) {throw new Error("Incomplete image attachment");}
    const capture = await store.save(Buffer.from(bytes), {
      kind: "attachment",
      target: attachment.id,
      label: attachment.name.replace(/\.[^.]+$/, ""),
    });
    attachment.imageNumber = Number(capture.id.slice("screenshot-".length));
    captures.push(capture);
  }
  return captures;
}

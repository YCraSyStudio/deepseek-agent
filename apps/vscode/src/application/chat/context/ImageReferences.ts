import type { ImageAttachment } from "@/contracts";

interface ConversationImageReference { id: string; fileName: string }

export function buildImageReferenceContext(
  images: readonly ConversationImageReference[],
  attachments: readonly ImageAttachment[],
  readsImagesNatively: boolean,
  minimizeMetadata = false,
): string {
  const blocks: string[] = [];
  if (images.length) {
    const routing = readsImagesNatively
      ? "Read images present as visual file parts directly without a tool call. A stored image number or screenshot id alone does not provide visual content. If a requested image is not present visually, call view_image with its screenshot_ids to reopen the stored original before declaring it unavailable. If retrieval fails, explain that the saved visual content is unavailable and request a new attachment only if needed. Never infer its contents from metadata or claim provider expiration merely because you cannot see an image."
      : "Use analyze_images with screenshot_ids when the user refers to image numbers; the current model does not read images natively.";
    blocks.push(`Conversation image references (stable numbers within this conversation):\n${images
      .map((image) => `- image ${image.id.slice("screenshot-".length)}: screenshot_id=${image.id}${minimizeMetadata ? "" : `; name=${JSON.stringify(image.fileName)}`}`)
      .join("\n")}\n${routing} Include newly attached images when comparing the previous and current state. A missing number may have been removed by retention; never substitute a different image.`);
  }
  if (attachments.length) {
    const routing = readsImagesNatively
      ? "Attached images are included as native visual file parts below. Inspect them directly in this generation."
      : "Attached images are available through analyze_images. The current model needs delegated vision to inspect them.";
    blocks.push(`${routing}\n${attachments
      .map((attachment) => `- ${attachment.imageNumber ? `image ${attachment.imageNumber}; ` : ""}id=${attachment.id}${minimizeMetadata ? "" : `; name=${JSON.stringify(attachment.name)}`}`)
      .join("\n")}`);
  }
  return blocks.length ? `\n\n${blocks.join("\n\n")}` : "";
}

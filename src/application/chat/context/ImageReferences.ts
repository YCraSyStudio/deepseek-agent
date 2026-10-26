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
      ? "Image numbers identify conversation images; they do not require a tool call. Read images present as visual file parts directly. A stored image number or screenshot id alone does not provide visual content. If the requested image is not present visually, report that it is unavailable in your visual context; never infer its contents from metadata."
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

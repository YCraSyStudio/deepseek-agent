import type { ImageAttachment } from "@/contracts";

interface ConversationImageReference { id: string; fileName: string }

export const NATIVE_IMAGE_ANALYSIS_DESCRIPTION = "Inspect stored screenshots or workspace image files that are not already present as visual file parts in this conversation, using DeepSeek V4.1 Flash. You already read attached images natively: answer directly from current or retained visual attachments, including their numbered references, without calling this tool. Use screenshot_ids (or latest) only for stored images whose visual content is unavailable, such as new captures or images removed from context by compaction. Workspace files are uploaded only when this tool is called. The result is a text description.";

export function buildImageReferenceContext(
  images: readonly ConversationImageReference[],
  attachments: readonly ImageAttachment[],
  readsImagesNatively: boolean,
): string {
  const blocks: string[] = [];
  if (images.length) {
    const routing = readsImagesNatively
      ? "Image numbers identify conversation images; they do not require a tool call. Read images already present as visual file parts directly. Use analyze_images with screenshot_ids only when the requested image is not available visually, for example a new capture or an older image removed by context compaction."
      : "Use analyze_images with screenshot_ids when the user refers to image numbers; the current model does not read images natively.";
    blocks.push(`Conversation image references (stable numbers within this conversation):\n${images
      .map((image) => `- image ${image.id.slice("screenshot-".length)}: screenshot_id=${image.id}; name=${JSON.stringify(image.fileName)}`)
      .join("\n")}\n${routing} Include newly attached images when comparing the previous and current state. A missing number may have been removed by retention; never substitute a different image.`);
  }
  if (attachments.length) {
    const routing = readsImagesNatively
      ? "Attached images are included as native visual file parts below. Inspect them directly; do not call analyze_images for these attachments or their image numbers."
      : "Attached images are available through analyze_images. The current model needs delegated vision to inspect them.";
    blocks.push(`${routing}\n${attachments
      .map((attachment) => `- ${attachment.imageNumber ? `image ${attachment.imageNumber}; ` : ""}id=${attachment.id}; name=${JSON.stringify(attachment.name)}`)
      .join("\n")}`);
  }
  return blocks.length ? `\n\n${blocks.join("\n\n")}` : "";
}

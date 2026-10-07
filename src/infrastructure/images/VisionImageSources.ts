import type { AnalyzeImagesRequest } from "@/application/tools/Types";
import type { ImageAttachment } from "@/contracts";
import { getToolWorkspaceHost, resolveWorkspacePathSecure } from "@/infrastructure/tools/ToolWorkspace";
import { realpath } from "node:fs/promises";
import { detectImageMediaType, type ImageMediaType } from "./ImageFormat";
import { ScreenshotStore } from "./ScreenshotStore";

export const MAX_VISION_IMAGES = 8;
export const MAX_VISION_BYTES = 32 * 1024 * 1024;
export interface LocalVisionImage { name: string; source: string; bytes: Uint8Array; mediaType: ImageMediaType }
export async function resolveVisionImageSources(request: AnalyzeImagesRequest, attachments: ImageAttachment[], screenshots?: ScreenshotStore): Promise<{ attachments: ImageAttachment[]; local: LocalVisionImage[] }> {
  const ids = request.attachmentIds ?? [];
  const screenshotIds = request.screenshotIds ?? [];
  const paths = request.paths ?? [];
  const explicitLocal = screenshotIds.length + paths.length > 0;
  const selected = ids.length ? ids.map((id) => {
    const attachment = attachments.find((item) => item.id === id);
    if (!attachment) {throw new Error(`Unknown attachment id: ${id}`);}
    return attachment;
  }) : explicitLocal ? [] : attachments;
  if (selected.length + screenshotIds.length + paths.length > MAX_VISION_IMAGES) {throw new Error("At most 8 images may be analyzed per call");}
  const local: LocalVisionImage[] = [];
  let total = selected.reduce((sum, image) => sum + image.size, 0);
  const add = (image: LocalVisionImage) => {
    total += image.bytes.length;
    if (image.bytes.length > 16 * 1024 * 1024 || total > MAX_VISION_BYTES) {throw new Error("Image analysis byte limit exceeded");}
    local.push(image);
  };
  for (const id of screenshotIds) {
    const capture = await screenshots?.lookup(id);
    if (!capture) {throw new Error(`Screenshot not found: ${id}`);}
    add({ name: capture.metadata.fileName, source: `screenshot:${capture.metadata.id}`, bytes: capture.bytes, mediaType: detectImageMediaType(capture.bytes)! });
  }
  for (const input of paths) {
    const workspace = getToolWorkspaceHost();
    const root = workspace.getRootPath();
    if (!root) {throw new Error("A local workspace is required for image paths");}
    // Strict confinement even when normal file tools have full-access exceptions.
    const resolved = await resolveWorkspacePathSecure(input, root, workspace.realPath?.bind(workspace) ?? realpath);
    const info = await workspace.stat(resolved.relativePath);
    if (info.size > 16 * 1024 * 1024 || total + info.size > MAX_VISION_BYTES) {throw new Error("Image analysis byte limit exceeded");}
    const bytes = await workspace.readFile(resolved.relativePath);
    const mediaType = detectImageMediaType(bytes);
    if (!mediaType) {throw new Error(`Unsupported image bytes: ${resolved.relativePath}`);}
    add({ name: resolved.relativePath.split(/[\\/]/).at(-1)!, source: resolved.relativePath, bytes, mediaType });
  }
  if (total > MAX_VISION_BYTES) {throw new Error("Image analysis byte limit exceeded");}
  return { attachments: selected, local };
}

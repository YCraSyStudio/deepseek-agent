import { getVsCodeApi } from "@webview/VsCodeApi";
import type { ImageAttachment, ReferencedFile } from "@/contracts";

export interface PersistentChatViewState {
  schemaVersion: 5;
  mode: "persistent";
  draft: string;
  referencedFiles: ReferencedFile[];
  imageAttachments: ImageAttachment[];
  conversationId?: string;
}

export function getSavedChatState(): PersistentChatViewState | undefined {
  const state = getVsCodeApi()?.getState<Record<string, unknown>>();
  if (!state || typeof state !== "object") {
    return undefined;
  }

  if (state.schemaVersion !== 5 || state.mode !== "persistent") {return undefined;}

  return {
    schemaVersion: 5,
    mode: "persistent",
    draft: typeof state.draft === "string" ? state.draft : "",
    referencedFiles: Array.isArray(state.referencedFiles)
      ? state.referencedFiles.filter(isReferencedFile).filter((file) => file.scope !== "external-snapshot")
      : [],
    imageAttachments: Array.isArray(state.imageAttachments)
      ? state.imageAttachments.filter(isImageAttachment)
      : [],
    conversationId: typeof state.conversationId === "string" && state.conversationId.trim() ? state.conversationId : undefined,
  };
}

export function referenceIdentity(file: ReferencedFile): string {
  return file.referenceId ?? `${file.scope ?? "workspace"}:${file.path}`;
}

export function isImageAttachment(value: unknown): value is ImageAttachment {
  if (!value || typeof value !== "object") {return false;}
  const image = value as Partial<ImageAttachment>;
  return typeof image.id === "string" && typeof image.fileId === "string" &&
    typeof image.name === "string" && typeof image.previewUri === "string" &&
    typeof image.expiresAt === "number" && image.expiresAt > Date.now();
}

export function isReferencedFile(value: unknown): value is ReferencedFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const file = value as Partial<ReferencedFile>;
  return typeof file.path === "string" && typeof file.name === "string" && (file.type === "file" || file.type === "directory");
}

export function mergeReferencedFiles(currentFiles: ReferencedFile[], newFiles: ReferencedFile[]): ReferencedFile[] {
  const seen = new Set(currentFiles.map((file) => file.path));
  const uniqueNewFiles = newFiles.filter((file) => {
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  });
  return [...currentFiles, ...uniqueNewFiles];
}

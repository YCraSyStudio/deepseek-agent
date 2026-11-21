import type { ImageAttachment, ReferencedFile } from "./messages/WebviewModels";

export interface ChatDraftData {
  draft: string;
  referencedFiles: ReferencedFile[];
  imageAttachments: ImageAttachment[];
}
export interface DraftImageData { name: string; mediaType: string; dataBase64: string }
export interface DraftAttachmentsData { images: DraftImageData[]; references: ReferencedFile[] }
export interface ChatDraftRequest {
  type: "chatDraft";
  requestId: string;
  operation: "read" | "write" | "delete";
  conversationId?: string;
  draft?: ChatDraftData;
  attachments?: DraftAttachmentsData;
}
export interface ChatDraftResult {
  type: "chatDraftResult";
  requestId: string;
  draft?: ChatDraftData;
  attachments?: DraftAttachmentsData;
  error?: string;
}

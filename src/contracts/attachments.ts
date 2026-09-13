import type { ImageAttachment } from "./messages/WebviewModels";
import { isRecord } from "@/shared/utils/TypeGuards";
import { isBoundedString } from "@/shared/utils/Validation";

const IMAGE_MEDIA_TYPES: ReadonlyArray<ImageAttachment["mediaType"]> = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const IMAGE_SOURCES: ReadonlyArray<ImageAttachment["source"]> = ["picker", "clipboard", "drop"];
const FILE_ID_PATTERN = /^file-api-[A-Za-z0-9_-]+$/;
const CACHE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_API_BASE_URL_LENGTH = 32_768;
const MAX_CACHE_FILE_NAME_LENGTH = 256;

/**
 * Structural check shared by the webview boundary and conversation persistence.
 * Context-specific limits (byte caps, extra-key rejection, URL policy) stay with each caller.
 */
export function isImageAttachmentShape(value: unknown): value is ImageAttachment {
  if (!isRecord(value)) {return false;}
  return isBoundedString(value.id, MAX_IDENTIFIER_LENGTH) &&
    isBoundedString(value.fileId, MAX_IDENTIFIER_LENGTH) && FILE_ID_PATTERN.test(value.fileId) &&
    isBoundedString(value.name, MAX_IDENTIFIER_LENGTH) &&
    IMAGE_MEDIA_TYPES.includes(value.mediaType as ImageAttachment["mediaType"]) &&
    Number.isSafeInteger(value.size) && (value.size as number) > 0 &&
    IMAGE_SOURCES.includes(value.source as ImageAttachment["source"]) &&
    Number.isSafeInteger(value.uploadedAt) && (value.uploadedAt as number) >= 0 &&
    Number.isSafeInteger(value.expiresAt) && (value.expiresAt as number) >= 0 &&
    isBoundedString(value.apiBaseUrl, MAX_API_BASE_URL_LENGTH) &&
    isBoundedString(value.cacheFileName, MAX_CACHE_FILE_NAME_LENGTH) && CACHE_FILE_NAME_PATTERN.test(value.cacheFileName) &&
    (value.previewUri === undefined || isBoundedString(value.previewUri, MAX_API_BASE_URL_LENGTH));
}

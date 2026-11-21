import { deepseekFetch } from "@/infrastructure/deepseek/client/DeepSeekFetch";
import { buildApiUrl } from "@/infrastructure/deepseek/client/DeepSeekFetch";
import { MAX_CHAT_RESPONSE_BYTES, readBoundedJson } from "@/infrastructure/deepseek/client/BoundedResponseJson";

const FILE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 512;

export interface DeepSeekFile {
  id: string;
  bytes: number;
  createdAt: number;
  filename: string;
  expiresAt?: number;
}

export async function uploadDeepSeekImage(options: {
  apiKey: string;
  baseUrl: string;
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  expiresAfterSeconds?: number;
  signal?: AbortSignal;
  minimizeMetadata?: boolean;
}): Promise<DeepSeekFile> {
  if (options.bytes.byteLength === 0 || options.bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("Images uploaded to DeepSeek must be between 1 byte and 64 MiB.");
  }
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[options.mediaType] ?? "bin";
  const filename = options.minimizeMetadata !== false ? `image.${extension}` : options.filename.slice(0, MAX_FILENAME_LENGTH);
  const form = new FormData();
  form.append("purpose", "user_data");
  if (options.expiresAfterSeconds !== undefined) {
    form.append("expires_after[anchor]", "created_at");
    form.append("expires_after[seconds]", String(options.expiresAfterSeconds));
  }
  const ownedBytes = Uint8Array.from(options.bytes);
  form.append("file", new Blob([ownedBytes.buffer], { type: options.mediaType }), filename);

  const response = await deepseekFetch({
    pathOrUrl: buildApiUrl(options.baseUrl, "files"),
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    timeoutMs: FILE_UPLOAD_TIMEOUT_MS,
    requestInit: { method: "POST", body: form, signal: options.signal },
  });
  return parseFile(await readBoundedJson(response, MAX_CHAT_RESPONSE_BYTES));
}

export async function deleteDeepSeekFile(options: {
  apiKey: string;
  baseUrl: string;
  fileId: string;
  signal?: AbortSignal;
}): Promise<void> {
  assertFileId(options.fileId);
  await deepseekFetch({
    pathOrUrl: buildApiUrl(options.baseUrl, `files/${encodeURIComponent(options.fileId)}`),
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    requestInit: { method: "DELETE", signal: options.signal },
  });
}

function parseFile(value: unknown): DeepSeekFile {
  if (!value || typeof value !== "object") {throw new Error("DeepSeek returned an invalid file response.");}
  const file = value as Record<string, unknown>;
  assertFileId(file.id);
  if (!Number.isSafeInteger(file.bytes) || (file.bytes as number) < 1 ||
    !Number.isSafeInteger(file.created_at) || (file.created_at as number) < 0 ||
    typeof file.filename !== "string") {
    throw new Error("DeepSeek returned incomplete file metadata.");
  }
  return {
    id: file.id as string,
    bytes: file.bytes as number,
    createdAt: file.created_at as number,
    filename: file.filename,
    ...(Number.isSafeInteger(file.expires_at) ? { expiresAt: file.expires_at as number } : {}),
  };
}

function assertFileId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^file-api-[A-Za-z0-9_-]+$/.test(value) || value.length > 512) {
    throw new Error("Invalid DeepSeek file identifier.");
  }
}

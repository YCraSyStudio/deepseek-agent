import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatDraftData, ChatDraftRequest, DraftAttachmentsData } from "@/contracts/ChatDraft";
import { getHistoryDirectory } from "./UserDataPaths";
import { withFileLock, writeJsonFileAtomic } from "./JsonFileStorage";
import { isRecord } from "@/shared/utils/TypeGuards";

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
export function isChatDraftRequest(value: Record<string, unknown>): boolean {
  return typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 128 &&
    ["read", "write", "delete"].includes(String(value.operation)) &&
    (value.conversationId === undefined || (typeof value.conversationId === "string" && /^[\w-]{1,200}$/.test(value.conversationId) && value.conversationId !== "new-chat-draft")) &&
    (value.draft === undefined || (isRecord(value.draft) && typeof value.draft.draft === "string" &&
      Array.isArray(value.draft.referencedFiles) && Array.isArray(value.draft.imageAttachments) && JSON.stringify(value.draft).length <= MAX_JSON_BYTES)) &&
    (value.attachments === undefined || (isRecord(value.attachments) && Array.isArray(value.attachments.references) &&
      JSON.stringify(value.attachments.references).length <= MAX_JSON_BYTES && Array.isArray(value.attachments.images) && value.attachments.images.length <= 8 &&
      value.attachments.images.every(image => isRecord(image) && typeof image.name === "string" && image.name.length <= 512 &&
        typeof image.mediaType === "string" && /^image\/(png|jpeg|gif|webp)$/.test(image.mediaType) &&
        typeof image.dataBase64 === "string" && image.dataBase64.length > 0 && image.dataBase64.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(image.dataBase64))));
}

interface StoredDraft { draft?: ChatDraftData; attachments?: Omit<DraftAttachmentsData, "images"> & { images: Array<{ name: string; mediaType: string; file: string }> } }
export class ChatDraftStore {
  constructor(private readonly root = getHistoryDirectory()) {}
  async handle(request: ChatDraftRequest): Promise<{ draft?: ChatDraftData; attachments?: DraftAttachmentsData }> {
    if (!isChatDraftRequest(request as unknown as Record<string, unknown>)) {throw new Error("Invalid draft request.");}
    await rejectSymlink(this.root);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withFileLock(path.join(this.root, ".drafts"), async () => {
      const parent = request.conversationId ? path.join(this.root, request.conversationId) : this.root;
      const directory = path.join(parent, request.conversationId ? "draft" : "new-chat-draft");
      await rejectSymlink(parent);
      await rejectSymlink(directory);
      if (request.operation === "delete") {await rm(directory, { recursive: true, force: true });return {};}
      const previous = await this.read(directory);
      if (request.operation === "read") {
        const images = [];
        for (const image of previous.attachments?.images ?? []) {
          if (!/^[a-f0-9-]+\.bin$/.test(image.file)) {throw new Error("Invalid draft attachment path.");}
          const file = path.join(directory, image.file);
          const stat = await lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_IMAGE_BYTES) {throw new Error("Invalid draft image.");}
          images.push({ name: image.name, mediaType: image.mediaType, dataBase64: (await readFile(file)).toString("base64") });
        }
        return { draft: previous.draft, attachments: previous.attachments ? { images, references: previous.attachments.references } : undefined };
      }
      const next: StoredDraft = { ...previous, ...(request.draft ? { draft: request.draft } : {}) };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (request.attachments) {
        const images = [];
        for (const image of request.attachments.images) {
          const bytes = Buffer.from(image.dataBase64, "base64");
          if (bytes.length > MAX_IMAGE_BYTES) {throw new Error("Draft image too large.");}
          const file = `${randomUUID()}.bin`;
          await writeFile(path.join(directory, file), bytes, { mode: 0o600, flag: "wx" });
          images.push({ name: image.name, mediaType: image.mediaType, file });
        }
        next.attachments = { images, references: request.attachments.references };
      }
      if (!next.draft?.draft && !next.draft?.referencedFiles.length && !next.draft?.imageAttachments.length &&
        !next.attachments?.images.length && !next.attachments?.references.length) {
        await rm(directory, { recursive: true, force: true });return {};
      }
      await writeJsonFileAtomic(path.join(directory, "draft.json"), next);
      const keep = new Set(next.attachments?.images.map(image => image.file) ?? []);
      for (const file of await readdir(directory)) {
        if (/^[a-f0-9-]+\.bin$/.test(file) && !keep.has(file)) {await rm(path.join(directory, file), { force: true });}
      }
      return {};
    });
  }
  private async read(directory: string): Promise<StoredDraft> {
    try {
      const file = path.join(directory, "draft.json");
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES * 3) {throw new Error("Invalid draft metadata.");}
      return JSON.parse(await readFile(file, "utf8")) as StoredDraft;
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {return {};}
      throw error;
    }
  }
}
async function rejectSymlink(file: string): Promise<void> {
  try {if ((await lstat(file)).isSymbolicLink()) {throw new Error("Draft storage cannot use symlinks.");}}
  catch (error) {if (!isRecord(error) || error.code !== "ENOENT") {throw error;}}
}

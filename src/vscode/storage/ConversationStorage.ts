import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { isConversation } from "@/application/chat/ConversationValidation";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import { writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { normalizeConversation } from "./ConversationNormalization";

export const MAX_CONVERSATION_BYTES = 64 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
const SEGMENT_STORAGE_SCHEMA_VERSION = 1;

interface SegmentedConversationManifest {
  storageSchemaVersion: typeof SEGMENT_STORAGE_SCHEMA_VERSION;
  conversation: Omit<StoredConversation, "messages">;
  chunks: string[];
}

export interface StoredConversationRecord {
  conversation: StoredConversation;
  filePath: string;
  sizeBytes: number;
}

export function getHistoryMutationTarget(): string {
  return path.join(getHistoryDirectory(), ".mutations");
}

function getConversationPath(id: string): string {
  return path.join(getHistoryDirectory(), `${encodeURIComponent(id)}.json`);
}

export async function readConversationFile(id: string): Promise<StoredConversation | undefined> {
  const filePath = getConversationPath(id);
  try {
    if ((await stat(filePath)).size > MAX_CONVERSATION_BYTES) {
      await deleteIncompatibleHistoryFile(filePath);
      return undefined;
    }
    const parsed = await readConversationStorage(filePath);
    if (!parsed || parsed.id !== id) {
      await deleteIncompatibleHistoryFile(filePath);
      return undefined;
    }
    return normalizeConversation(parsed);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      await deleteIncompatibleHistoryFile(filePath);
    }
    return undefined;
  }
}

export async function readStoredConversationRecord(filePath: string): Promise<StoredConversationRecord | undefined> {
  try {
    const metadata = await stat(filePath);
    if (metadata.size > MAX_CONVERSATION_BYTES) {
      await deleteIncompatibleHistoryFile(filePath);
      return undefined;
    }
    const parsed = await readConversationStorage(filePath);
    if (!parsed || path.resolve(filePath) !== path.resolve(getConversationPath(parsed.id))) {
      await deleteIncompatibleHistoryFile(filePath);
      return undefined;
    }
    return {
      conversation: normalizeConversation(parsed),
      filePath,
      sizeBytes: Buffer.byteLength(JSON.stringify(parsed), "utf8"),
    };
  } catch {
    await deleteIncompatibleHistoryFile(filePath);
    return undefined;
  }
}

export async function writeConversationStorage(conversation: StoredConversation): Promise<void> {
  const filePath = getConversationPath(conversation.id);
  if (Buffer.byteLength(JSON.stringify(conversation), "utf8") <= MAX_SEGMENT_BYTES) {
    await writeJsonFileAtomic(filePath, conversation);
    await removeConversationSegments(conversation.id);
    return;
  }

  const generation = `${encodeURIComponent(conversation.id)}-${conversation.updatedAt}`;
  const segmentDirectory = path.join(getHistoryDirectory(), ".segments", generation);
  await mkdir(segmentDirectory, { recursive: true });
  const chunks = chunkConversationMessages(conversation.messages);
  const chunkPaths: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const relative = path.posix.join(".segments", generation, `${String(index).padStart(5, "0")}.json`);
    await writeJsonFileAtomic(path.join(getHistoryDirectory(), ...relative.split("/")), chunks[index]);
    chunkPaths.push(relative);
  }
  const { messages: _messages, ...metadata } = conversation;
  const manifest: SegmentedConversationManifest = {
    storageSchemaVersion: SEGMENT_STORAGE_SCHEMA_VERSION,
    conversation: metadata,
    chunks: chunkPaths,
  };
  await writeJsonFileAtomic(filePath, manifest);
  await removeConversationSegments(conversation.id, generation);
}

export async function deleteConversationStorage(id: string): Promise<void> {
  await rm(getConversationPath(id), { force: true });
  await removeConversationSegments(id);
}

async function deleteIncompatibleHistoryFile(filePath: string): Promise<void> {
  const encodedId = path.basename(filePath, path.extname(filePath));
  await rm(filePath, { force: true }).catch(() => undefined);
  await removeConversationSegmentsByEncodedId(encodedId);
}

function chunkConversationMessages(messages: StoredConversation["messages"]): StoredConversation["messages"][] {
  const chunks: StoredConversation["messages"][] = [];
  let current: StoredConversation["messages"] = [];
  let currentBytes = 2;
  for (const message of messages) {
    const bytes = Buffer.byteLength(JSON.stringify(message), "utf8") + 1;
    if (current.length > 0 && currentBytes + bytes > MAX_SEGMENT_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(message);
    currentBytes += bytes;
  }
  if (current.length > 0) {chunks.push(current);}
  return chunks;
}

async function readConversationStorage(filePath: string): Promise<StoredConversation | undefined> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (isConversation(parsed)) {return parsed;}
  if (!isSegmentedManifest(parsed)) {return undefined;}
  const messages: StoredConversation["messages"] = [];
  for (const relative of parsed.chunks) {
    const chunkPath = path.resolve(getHistoryDirectory(), ...relative.split("/"));
    const segmentRoot = path.resolve(getHistoryDirectory(), ".segments");
    if (!chunkPath.startsWith(`${segmentRoot}${path.sep}`)) {return undefined;}
    const metadata = await stat(chunkPath);
    if (metadata.size > MAX_SEGMENT_BYTES + 1024 * 1024) {return undefined;}
    const chunk = JSON.parse(await readFile(chunkPath, "utf8")) as unknown;
    if (!Array.isArray(chunk)) {return undefined;}
    messages.push(...chunk as StoredConversation["messages"]);
  }
  const conversation = { ...parsed.conversation, messages };
  return isConversation(conversation) ? conversation : undefined;
}

function isSegmentedManifest(value: unknown): value is SegmentedConversationManifest {
  if (!value || typeof value !== "object") {return false;}
  const manifest = value as Partial<SegmentedConversationManifest>;
  return manifest.storageSchemaVersion === SEGMENT_STORAGE_SCHEMA_VERSION &&
    !!manifest.conversation && typeof manifest.conversation === "object" &&
    Array.isArray(manifest.chunks) && manifest.chunks.length <= 10_000 &&
    manifest.chunks.every((chunk) => typeof chunk === "string" && /^\.segments\/[a-zA-Z0-9%_.~-]+\/\d{5}\.json$/.test(chunk));
}

async function removeConversationSegments(id: string, keepGeneration?: string): Promise<void> {
  await removeConversationSegmentsByEncodedId(encodeURIComponent(id), keepGeneration);
}

async function removeConversationSegmentsByEncodedId(encodedId: string, keepGeneration?: string): Promise<void> {
  const root = path.join(getHistoryDirectory(), ".segments");
  const prefix = `${encodedId}-`;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix) && entry.name !== keepGeneration)
    .map((entry) => rm(path.join(root, entry.name), { recursive: true, force: true })));
}

function isFileNotFoundError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { isConversation } from "@/application/chat/ConversationValidation";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import { writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { normalizeConversation } from "./ConversationNormalization";

export const MAX_CONVERSATION_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_COUNT = 10_000;
const CHUNK_STORAGE_SCHEMA_VERSION = 1;
const MANIFEST_FILE_NAME = "manifest.json";
const CHUNK_FILE_PATTERN = /^\d{1,5}\.json$/;
const LEGACY_SEGMENT_DIRECTORY_NAME = ".segments";

interface ConversationManifest {
  storageSchemaVersion: typeof CHUNK_STORAGE_SCHEMA_VERSION;
  conversation: Omit<StoredConversation, "messages">;
  chunks: number;
}

export interface StoredConversationRecord {
  conversation: StoredConversation;
  directoryPath: string;
  sizeBytes: number;
}

export function getHistoryMutationTarget(): string {
  return path.join(getHistoryDirectory(), ".mutations");
}

function getConversationDirectory(id: string): string {
  return path.join(getHistoryDirectory(), encodeURIComponent(id));
}

export async function readConversationFile(id: string): Promise<StoredConversation | undefined> {
  const directoryPath = getConversationDirectory(id);
  try {
    const parsed = await readConversationStorage(directoryPath);
    if (!parsed || parsed.id !== id) {
      await deleteIncompatibleConversation(directoryPath);
      return undefined;
    }
    return normalizeConversation(parsed);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      await deleteIncompatibleConversation(directoryPath);
    }
    return undefined;
  }
}

export async function readStoredConversationRecord(directoryPath: string): Promise<StoredConversationRecord | undefined> {
  try {
    const parsed = await readConversationStorage(directoryPath);
    if (!parsed || path.resolve(directoryPath) !== path.resolve(getConversationDirectory(parsed.id))) {
      await deleteIncompatibleConversation(directoryPath);
      return undefined;
    }
    return {
      conversation: normalizeConversation(parsed),
      directoryPath,
      sizeBytes: Buffer.byteLength(JSON.stringify(parsed), "utf8"),
    };
  } catch {
    await deleteIncompatibleConversation(directoryPath);
    return undefined;
  }
}

export async function writeConversationStorage(conversation: StoredConversation): Promise<void> {
  const directoryPath = getConversationDirectory(conversation.id);
  await mkdir(directoryPath, { recursive: true });
  const chunks = chunkConversationMessages(conversation.messages);
  for (let index = 0; index < chunks.length; index += 1) {
    await writeJsonFileAtomic(path.join(directoryPath, `${index}.json`), chunks[index]);
  }
  const { messages: _messages, ...metadata } = conversation;
  const manifest: ConversationManifest = {
    storageSchemaVersion: CHUNK_STORAGE_SCHEMA_VERSION,
    conversation: metadata,
    chunks: chunks.length,
  };
  await writeJsonFileAtomic(path.join(directoryPath, MANIFEST_FILE_NAME), manifest);
  await removeStaleChunks(directoryPath, chunks.length);
}

export async function deleteConversationStorage(id: string): Promise<void> {
  await deleteIncompatibleConversation(getConversationDirectory(id));
}

export async function purgeLegacyConversationStorage(): Promise<void> {
  const historyDirectory = getHistoryDirectory();
  const entries = await readdir(historyDirectory, { withFileTypes: true }).catch(() => []);
  const legacyPaths = entries
    .filter((entry) =>
      (entry.isFile() && entry.name.endsWith(".json")) ||
      (entry.isDirectory() && entry.name === LEGACY_SEGMENT_DIRECTORY_NAME))
    .map((entry) => path.join(historyDirectory, entry.name));
  await Promise.all(legacyPaths.map((legacyPath) => deleteIncompatibleConversation(legacyPath)));
}

async function deleteIncompatibleConversation(directoryPath: string): Promise<void> {
  await rm(directoryPath, { recursive: true, force: true }).catch(() => undefined);
}

function chunkConversationMessages(messages: StoredConversation["messages"]): StoredConversation["messages"][] {
  const chunks: StoredConversation["messages"][] = [];
  let current: StoredConversation["messages"] = [];
  let currentBytes = 2;
  for (const message of messages) {
    const bytes = Buffer.byteLength(JSON.stringify(message), "utf8") + 1;
    if (current.length > 0 && currentBytes + bytes > MAX_CHUNK_BYTES) {
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

async function readConversationStorage(directoryPath: string): Promise<StoredConversation | undefined> {
  const parsed = JSON.parse(await readFile(path.join(directoryPath, MANIFEST_FILE_NAME), "utf8")) as unknown;
  if (!isConversationManifest(parsed)) {return undefined;}
  const chunkPaths = await listChunkPaths(directoryPath, parsed.chunks);
  if (!chunkPaths) {return undefined;}
  const messages: StoredConversation["messages"] = [];
  let totalBytes = 0;
  for (const chunkPath of chunkPaths) {
    const metadata = await stat(chunkPath);
    if (metadata.size > MAX_CHUNK_BYTES + 1024 * 1024) {return undefined;}
    totalBytes += metadata.size;
    if (totalBytes > MAX_CONVERSATION_BYTES) {return undefined;}
    const chunk = JSON.parse(await readFile(chunkPath, "utf8")) as unknown;
    if (!Array.isArray(chunk)) {return undefined;}
    messages.push(...chunk as StoredConversation["messages"]);
  }
  const conversation = { ...parsed.conversation, messages };
  return isConversation(conversation) ? conversation : undefined;
}

async function listChunkPaths(directoryPath: string, expectedChunks: number): Promise<string[] | undefined> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const indexed: Array<{ index: number; filePath: string }> = [];
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILE_NAME || entry.name.startsWith(".")) {continue;}
    const match = entry.isFile() ? CHUNK_FILE_PATTERN.exec(entry.name) : null;
    if (!match) {return undefined;}
    indexed.push({ index: Number.parseInt(match[1]!, 10), filePath: path.join(directoryPath, entry.name) });
  }
  if (indexed.length !== expectedChunks) {return undefined;}
  indexed.sort((left, right) => left.index - right.index);
  if (indexed.some((entry, position) => entry.index !== position)) {return undefined;}
  return indexed.map((entry) => entry.filePath);
}

function isConversationManifest(value: unknown): value is ConversationManifest {
  if (!value || typeof value !== "object") {return false;}
  const manifest = value as Partial<ConversationManifest>;
  const chunks = manifest.chunks;
  return manifest.storageSchemaVersion === CHUNK_STORAGE_SCHEMA_VERSION &&
    !!manifest.conversation && typeof manifest.conversation === "object" &&
    typeof chunks === "number" && Number.isSafeInteger(chunks) && chunks >= 0 && chunks <= MAX_CHUNK_COUNT;
}

async function removeStaleChunks(directoryPath: string, chunkCount: number): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, match: CHUNK_FILE_PATTERN.exec(entry.name) }))
    .filter(({ match }) => match !== null && Number.parseInt(match[1]!, 10) >= chunkCount)
    .map(({ entry }) => rm(path.join(directoryPath, entry.name), { force: true }).catch(() => undefined)));
}

function isFileNotFoundError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

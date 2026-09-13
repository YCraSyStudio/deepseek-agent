import { mkdir, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import type { ConversationSummary } from "@/contracts";
import { findDuplicateConversationIds } from "@/application/chat/ConversationDeduplication";
import { isConversation } from "@/application/chat/ConversationValidation";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import type { SettingsRepository } from "@/application/ports";
import { withFileLock } from "@/infrastructure/persistence/JsonFileStorage";
import { getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import { normalizeConversation, toConversationSummary } from "./ConversationNormalization";
import {
  deleteConversationStorage,
  getHistoryMutationTarget,
  MAX_CONVERSATION_BYTES,
  readConversationFile,
  readStoredConversationRecord,
  writeConversationStorage,
  type StoredConversationRecord,
} from "./ConversationStorage";

const MAX_CONVERSATIONS = 100;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export class HistoryManager {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly settings: SettingsRepository) {}

  async initialize(): Promise<void> {
    await withFileLock(getHistoryMutationTarget(), async () => {
      await rm(path.join(getHistoryDirectory(), "corrupt"), { recursive: true, force: true });
      await this.readAll();
    });
  }

  getWorkspaceBinding() {
    return captureCurrentWorkspaceBinding();
  }

  async getSummaries(): Promise<ConversationSummary[]> {
    if (!this.settings.load().historyEnabled) {return [];}
    await this.waitForPendingMutations();
    return withFileLock(getHistoryMutationTarget(), async () => {
      const records = await this.readAll();
      const retained = await this.applyRetentionAndLimits(records);
      return retained
        .map((record) => toConversationSummary(record.conversation, record.sizeBytes))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async save(conversation: StoredConversation): Promise<void> {
    if (!this.settings.load().historyEnabled) {return;}
    const normalized = validateAndNormalizeConversation(conversation);
    await this.enqueueMutation(async () => {
      const current = await readConversationFile(normalized.id);
      if (current && (
        current.updatedAt > normalized.updatedAt ||
        (current.updatedAt === normalized.updatedAt && JSON.stringify(current) !== JSON.stringify(normalized))
      )) {
        throw new Error("Conversation changed in another VS Code window. Reload it before saving more messages.");
      }
      await writeConversationStorage(normalized);
      await this.applyRetentionAndLimits(await this.readAll(), new Set([normalized.id]));
    });
  }

  async delete(id: string, expectedUpdatedAt?: number): Promise<boolean> {
    const deleted = await this.deleteMany([{ id, expectedUpdatedAt }]);
    return deleted.includes(id);
  }

  async deleteMany(entries: Array<string | { id: string; expectedUpdatedAt?: number }>): Promise<string[]> {
    if (!this.settings.load().historyEnabled) {return [];}
    const uniqueEntries = [...new Map(entries.map((entry) => {
      const normalized = typeof entry === "string" ? { id: entry } : entry;
      return [normalized.id, normalized];
    })).values()];
    const deleted: string[] = [];
    await this.enqueueMutation(async () => {
      for (const entry of uniqueEntries) {
        if (entry.expectedUpdatedAt !== undefined) {
          const current = await readConversationFile(entry.id);
          if (!current || current.updatedAt !== entry.expectedUpdatedAt) {continue;}
        }
        await deleteConversationStorage(entry.id);
        deleted.push(entry.id);
      }
    });
    return deleted;
  }

  async saveIfAbsent(conversation: StoredConversation): Promise<boolean> {
    if (!this.settings.load().historyEnabled) {return false;}
    const normalized = validateAndNormalizeConversation(conversation);
    let saved = false;
    await this.enqueueMutation(async () => {
      if (await readConversationFile(conversation.id)) {return;}
      await writeConversationStorage(normalized);
      saved = true;
    });
    return saved;
  }

  async getById(id: string): Promise<StoredConversation | undefined> {
    if (!this.settings.load().historyEnabled) {return undefined;}
    await this.waitForPendingMutations();
    return readConversationFile(id);
  }

  private async readAll(): Promise<StoredConversationRecord[]> {
    await mkdir(getHistoryDirectory(), { recursive: true });
    const entries = await readdir(getHistoryDirectory(), { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readStoredConversationRecord(path.join(getHistoryDirectory(), entry.name))),
    );
    return records.filter((record): record is StoredConversationRecord => record !== undefined);
  }

  private async applyRetentionAndLimits(
    records: StoredConversationRecord[],
    protectedIds: ReadonlySet<string> = new Set(),
  ): Promise<StoredConversationRecord[]> {
    const retentionDays = this.settings.load().historyRetentionDays;
    const threshold = retentionDays === 0 ? 0 : Date.now() - retentionDays * 86_400_000;
    const duplicateIds = findDuplicateConversationIds(records.map((record) => record.conversation));
    const duplicates = records.filter((record) => duplicateIds.has(record.conversation.id));
    const sorted = records
      .filter((record) => !duplicateIds.has(record.conversation.id))
      .sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt);
    const retained: StoredConversationRecord[] = [];
    const removed: StoredConversationRecord[] = [...duplicates];
    let totalBytes = 0;

    for (const record of sorted) {
      const expired = threshold !== 0 && record.conversation.updatedAt < threshold;
      const exceedsLimits = retained.length >= MAX_CONVERSATIONS || totalBytes + record.sizeBytes > MAX_TOTAL_BYTES;
      if ((expired || exceedsLimits) && !protectedIds.has(record.conversation.id)) {
        removed.push(record);
      } else {
        retained.push(record);
        totalBytes += record.sizeBytes;
      }
    }

    await Promise.all(removed.map((record) => deleteConversationStorage(record.conversation.id)));
    return retained;
  }

  private async waitForPendingMutations(): Promise<void> {
    await this.mutationQueue;
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const runWithLock = () => withFileLock(getHistoryMutationTarget(), operation);
    const next = this.mutationQueue.then(runWithLock, runWithLock);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

function validateAndNormalizeConversation(conversation: StoredConversation): StoredConversation {
  if (!isConversation(conversation)) {
    throw new Error("Refusing to persist an incompatible conversation");
  }
  const normalized = normalizeConversation(conversation);
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_CONVERSATION_BYTES) {
    throw new Error("Conversation is too large to save safely. Reduce its retained context before continuing.");
  }
  return normalized;
}

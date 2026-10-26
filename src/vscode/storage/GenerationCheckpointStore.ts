import { migrateGenerationCheckpoints } from "@/infrastructure/persistence/UserDataMigration";
import { logWarning } from "@/shared/logging/Logger";
import { lstat, readdir, readFile, rm, rmdir } from "node:fs/promises";
import * as path from "node:path";
import type { AppConfig, AssistantTimelineEvent, ConversationMessage, PermissionSnapshot, QueuedGenerationMessage, StoredToolCall, WorkspaceBinding } from "@/contracts";
import { isWorkspaceBinding } from "@/application/chat/ConversationValidation";
import { isProviderTranscript, type ProviderTranscript } from "@/application/chat/ProviderTranscript";
import { writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { getHistoryDirectory, getGenerationCheckpointPath, getLegacyGenerationCheckpointDirectory } from "@/infrastructure/persistence/UserDataPaths";
import type { SettingsRepository } from "@/application/ports";
import { fitToolResultForModel } from "@/application/chat/toolCall/ToolResultFit";
import { boundUtf8HeadTail } from "@/shared/utils/BoundedText";

const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKPOINT_TEXT_BYTES = 512 * 1024;

interface GenerationCheckpoint {
  schemaVersion: 3;
  revision: number;
  conversationId: string;
  generationId?: string;
  status: "queued" | "starting" | "compacting" | "streaming" | "awaiting_confirmation" | "running_tool" | "cancelling" | "cancelled" | "interrupted" | "completed" | "error";
  userMessage?: ConversationMessage;
  content: string;
  timeline: AssistantTimelineEvent[];
  toolCalls: StoredToolCall[];
  queue: QueuedGenerationMessage[];
  config?: Omit<AppConfig, "apiKey">;
  permissionSnapshot?: PermissionSnapshot;
  providerTranscript?: ProviderTranscript;
  workspaceUri: string;
  workspaceBinding: WorkspaceBinding;
  updatedAt: number;
}

export class GenerationCheckpointStore {
  private readonly revisions = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private epoch = 0;

  constructor(private readonly settings: SettingsRepository) {}

  async save(checkpoint: Omit<GenerationCheckpoint, "schemaVersion" | "revision">): Promise<GenerationCheckpoint> {
    const revision = (this.revisions.get(checkpoint.conversationId) ?? 0) + 1;
    this.revisions.set(checkpoint.conversationId, revision);
    let value: GenerationCheckpoint = { schemaVersion: 3, revision, ...checkpoint };
    if (serializedBytes(value) > MAX_CHECKPOINT_BYTES) {
      value = compactCheckpoint(value);
    }
    if (serializedBytes(value) > MAX_CHECKPOINT_BYTES) {
      throw new Error("Generation checkpoint exceeded its 16 MiB persistence limit after compaction");
    }
    const epoch = this.epoch;
    if (!this.settings.load().historyEnabled) {
      return value;
    }
    await this.enqueue(checkpoint.conversationId, async () => {
      if (
        epoch !== this.epoch ||
        !this.settings.load().historyEnabled ||
        (this.revisions.get(checkpoint.conversationId) ?? 0) !== revision
      ) {
        return;
      }
      await assertCheckpointLocation(this.getPath(checkpoint.conversationId));
      await writeJsonFileAtomic(this.getPath(checkpoint.conversationId), value);
    });
    return value;
  }

  async delete(conversationId: string): Promise<void> {
    this.revisions.delete(conversationId);
    await this.enqueue(conversationId, async () => {
      await assertCheckpointLocation(this.getPath(conversationId));
      await rm(this.getPath(conversationId), { force: true });
      const legacy = getLegacyGenerationCheckpointDirectory();
      const old = await lstat(legacy).catch(error => {if (isMissing(error)) {return undefined;} throw error;});
      if (old?.isDirectory() && !old.isSymbolicLink()) {await rm(path.join(legacy, `${safeFileName(conversationId)}.json`), { force: true });}
    });
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.queues.values());
  }

  async recover(): Promise<GenerationCheckpoint[]> {
    if (!this.settings.load().historyEnabled) {await this.clearAll(); return [];}
    await migrateGenerationCheckpoints().catch((error: unknown) => {
      logWarning("[Storage] Could not migrate generation checkpoints; originals preserved", error);
    });
    await assertCheckpointLocation();
    const entries = await listHistoryDirectories();
    const checkpoints: GenerationCheckpoint[] = [];
    for (const entry of entries) {
      const filePath = path.join(getHistoryDirectory(), entry, "checkpoint.json");
      try {
        const stat = await lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CHECKPOINT_BYTES) {throw new Error("Invalid checkpoint file");}
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        if (!isGenerationCheckpoint(parsed) || filePath !== this.getPath(parsed.conversationId)) {throw new Error("Invalid generation checkpoint");}
        this.revisions.set(parsed.conversationId, parsed.revision);
        checkpoints.push(parsed);
      } catch (error) {
        if (!isMissing(error)) {await rm(filePath, { force: true }).catch(() => undefined);}
      }
    }
    return checkpoints;
  }

  async clearAll(): Promise<void> {
    this.epoch += 1;
    this.revisions.clear();
    await this.flush();
    await assertCheckpointLocation();
    await Promise.all((await listHistoryDirectories()).map(entry =>
      rm(path.join(getHistoryDirectory(), entry, "checkpoint.json"), { force: true })));
    const legacy = getLegacyGenerationCheckpointDirectory();
    const old = await lstat(legacy).catch(error => {if (isMissing(error)) {return undefined;} throw error;});
    if (old?.isDirectory() && !old.isSymbolicLink()) {
      for (const entry of await readdir(legacy, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) {await rm(path.join(legacy, entry.name), { force: true });}
      }
      await rmdir(legacy).catch(error => {if (isMissing(error) || ["ENOTEMPTY", "EEXIST"].includes(String(error.code))) {return;} throw error;});
    }
  }

  private getPath(conversationId: string): string {
    return getGenerationCheckpointPath(conversationId);
  }

  private enqueue(conversationId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(conversationId, next.catch(() => undefined));
    return next;
  }
}

async function listHistoryDirectories(): Promise<string[]> {
  const entries = await readdir(getHistoryDirectory(), { withFileTypes: true }).catch((error: unknown) => {
    if (isMissing(error)) {return [];}
    throw error;
  });
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "new-chat-draft").map(entry => entry.name);
}

async function assertCheckpointLocation(filePath?: string): Promise<void> {
  for (const directory of [getHistoryDirectory(), ...(filePath ? [path.dirname(filePath)] : [])]) {
    const stat = await lstat(directory).catch(error => {if (isMissing(error)) {return undefined;} throw error;});
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {throw new Error("Checkpoint storage cannot use redirected directories");}
  }
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isGenerationCheckpoint(value: unknown): value is GenerationCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<GenerationCheckpoint>;
  return record.schemaVersion === 3 &&
    Number.isSafeInteger(record.revision) &&
    typeof record.conversationId === "string" &&
    typeof record.status === "string" &&
    typeof record.content === "string" &&
    Array.isArray(record.timeline) &&
    Array.isArray(record.toolCalls) &&
    Array.isArray(record.queue) &&
    typeof record.workspaceUri === "string" &&
    isWorkspaceBinding(record.workspaceBinding) &&
    record.workspaceUri === record.workspaceBinding.uri &&
    (record.permissionSnapshot === undefined || isPermissionSnapshot(record.permissionSnapshot)) &&
    (record.providerTranscript === undefined || isProviderTranscript(record.providerTranscript)) &&
    typeof record.updatedAt === "number";
}

function compactCheckpoint(value: GenerationCheckpoint): GenerationCheckpoint {
  return {
    ...value,
    schemaVersion: 3,
    timeline: value.timeline
      .filter((event) => event.type !== "content")
      .map((event) => event.type === "reasoning" ? { ...event, content: boundUtf8HeadTail(event.content, MAX_CHECKPOINT_TEXT_BYTES).text } : event),
    toolCalls: value.toolCalls.map((tool) => ({
      ...tool,
      arguments: fitToolResultForModel(tool.arguments),
      ...(tool.result !== undefined ? { result: fitToolResultForModel(tool.result) } : {}),
    })),
    queue: value.queue.map((entry) => ({ ...entry, text: fitToolResultForModel(entry.text) })),
  };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isPermissionSnapshot(value: unknown): value is PermissionSnapshot {
  if (!value || typeof value !== "object") {return false;}
  const snapshot = value as Partial<PermissionSnapshot>;
  return Number.isSafeInteger(snapshot.revision) &&
    typeof snapshot.workspaceTrusted === "boolean" &&
    typeof snapshot.fingerprint === "string" &&
    (snapshot.permissionMode === "default" || snapshot.permissionMode === "full-access" || snapshot.permissionMode === "auto-approve");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 512);
}

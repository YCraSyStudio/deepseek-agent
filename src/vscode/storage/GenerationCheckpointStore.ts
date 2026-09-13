import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import type { AppConfig, AssistantTimelineEvent, ConversationMessage, PermissionSnapshot, QueuedGenerationMessage, StoredToolCall, WorkspaceBinding } from "@/contracts";
import { isWorkspaceBinding } from "@/application/chat/ConversationValidation";
import { isProviderTranscript, type ProviderTranscript } from "@/application/chat/ProviderTranscript";
import { writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { getGenerationCheckpointDirectory } from "@/infrastructure/persistence/UserDataPaths";
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
      await writeJsonFileAtomic(this.getPath(checkpoint.conversationId), value);
    });
    return value;
  }

  async delete(conversationId: string): Promise<void> {
    this.revisions.delete(conversationId);
    await this.enqueue(conversationId, () => rm(this.getPath(conversationId), { force: true }));
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.queues.values());
  }

  async recover(): Promise<GenerationCheckpoint[]> {
    if (!this.settings.load().historyEnabled) {
      await this.clearAll();
      return [];
    }
    const directory = getGenerationCheckpointDirectory();
    await mkdir(directory, { recursive: true });
    await rm(path.join(directory, "corrupt"), { recursive: true, force: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const checkpoints: GenerationCheckpoint[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        if (!isGenerationCheckpoint(parsed) || entry.name !== `${safeFileName(parsed.conversationId)}.json`) {
          throw new Error("Invalid generation checkpoint");
        }
        this.revisions.set(parsed.conversationId, parsed.revision);
        checkpoints.push(parsed);
      } catch {
        await rm(filePath, { force: true }).catch(() => undefined);
      }
    }
    return checkpoints;
  }

  async clearAll(): Promise<void> {
    this.epoch += 1;
    this.revisions.clear();
    await this.flush();
    const directory = getGenerationCheckpointDirectory();
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => rm(path.join(directory, entry.name), { force: true })));
  }

  private getPath(conversationId: string): string {
    return path.join(getGenerationCheckpointDirectory(), `${safeFileName(conversationId)}.json`);
  }

  private enqueue(conversationId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(conversationId, next.catch(() => undefined));
    return next;
  }
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

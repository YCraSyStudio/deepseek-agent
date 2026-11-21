import { createHash, randomUUID } from "node:crypto";

export interface RecordedFileChange {
  id: string;
  path: string;
  before: string;
  after: string;
  beforeHash?: string;
  afterHash: string;
}

export interface FileChangeRegistryOptions {
  maxEntries: number;
  maxDocumentBytes: number;
}

const DEFAULT_OPTIONS: FileChangeRegistryOptions = {
  maxEntries: 32,
  maxDocumentBytes: 512 * 1024,
};

export class FileChangeRegistry {
  private readonly changes = new Map<string, RecordedFileChange>();

  constructor(private readonly options: FileChangeRegistryOptions = DEFAULT_OPTIONS) {}

  public record(path: string, before: Uint8Array | undefined, after: Uint8Array): RecordedFileChange | undefined {
    if (!path.trim() || after.byteLength > this.options.maxDocumentBytes) {
      return undefined;
    }
    if (before && before.byteLength > this.options.maxDocumentBytes) {
      return undefined;
    }
    if (looksBinary(after) || (before && looksBinary(before))) {
      return undefined;
    }

    const change: RecordedFileChange = {
      id: randomUUID(),
      path: path.replace(/\\/g, "/"),
      before: before ? Buffer.from(before).toString("utf-8") : "",
      after: Buffer.from(after).toString("utf-8"),
      beforeHash: before ? hashBytes(before) : undefined,
      afterHash: hashBytes(after),
    };
    this.changes.set(change.id, change);
    this.evict();
    return change;
  }

  public find(path: string, beforeHash: string | undefined, afterHash: string): RecordedFileChange | undefined {
    const entries = [...this.changes.values()];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const change = entries[index]!;
      if (change.afterHash !== afterHash) {
        continue;
      }
      if (beforeHash !== undefined && change.beforeHash !== beforeHash) {
        continue;
      }
      if (pathsMatch(change.path, path)) {
        return change;
      }
    }
    return undefined;
  }

  public clear(): void {
    this.changes.clear();
  }

  public get size(): number {
    return this.changes.size;
  }

  private evict(): void {
    while (this.changes.size > this.options.maxEntries) {
      const oldest = this.changes.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.changes.delete(oldest);
    }
  }
}

export const fileChangeRegistry = new FileChangeRegistry();

function pathsMatch(recordedPath: string, requestedPath: string): boolean {
  const recorded = recordedPath.replace(/^\.\//, "");
  const requested = requestedPath.replace(/^\.\//, "");
  if (recorded === requested) {
    return true;
  }
  if (recorded.includes("..") || requested.includes("..")) {
    return false;
  }
  return recorded.endsWith(`/${requested}`) || requested.endsWith(`/${recorded}`);
}

function hashBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function looksBinary(content: Uint8Array): boolean {
  const limit = Math.min(content.byteLength, 4096);
  for (let index = 0; index < limit; index += 1) {
    const byte = content[index]!;
    if (byte === 0 || byte < 8 || (byte > 13 && byte < 32)) {
      return true;
    }
  }
  return false;
}

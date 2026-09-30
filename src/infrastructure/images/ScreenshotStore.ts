import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import * as path from "node:path";
import { getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { withFileLock, writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { inspectCapture } from "./ImageFormat";

export const SCREENSHOT_DIRECTORY_NAME = ".screenshots";
export interface ScreenshotMetadata {
  id: string; fileName: string; kind: "web" | "window" | "debug" | "screen";
  target: string; windowTitle?: string; pid?: number;
  width: number; height: number; bytes: number; sha256: string;
  createdAt: number; accessedAt: number;
}
interface ScreenshotIndex { next: number; items: ScreenshotMetadata[] }
export type CaptureDescription = Pick<ScreenshotMetadata, "kind" | "target" | "windowTitle" | "pid"> & { label?: string };

export class ScreenshotStore {
  readonly directory: string;
  constructor(readonly conversationId: string, private readonly historyRoot = getHistoryDirectory(), private readonly maxCount = 40, private readonly maxBytes = 40 * 1024 * 1024) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(conversationId)) {throw new Error("Invalid screenshot conversation id");}
    if (maxCount < 1 || maxBytes < 1) {throw new Error("Invalid screenshot retention limits");}
    this.directory = path.join(historyRoot, conversationId, SCREENSHOT_DIRECTORY_NAME);
  }

  async save(bytes: Buffer, description: CaptureDescription): Promise<ScreenshotMetadata> {
    if (bytes.length > Math.min(this.maxBytes, 16 * 1024 * 1024)) {throw new Error("Screenshot exceeds the capture size limit");}
    const dimensions = inspectCapture(bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return this.lock(async () => {
      // Refuse to resurrect a deleted conversation or create an invalid history folder.
      await stat(path.join(this.historyRoot, this.conversationId, "manifest.json"));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.assertDirectory();
      const index = await this.index();
      const duplicate = index.items.find((item) => item.sha256 === sha256 && item.kind === description.kind && item.target === description.target);
      if (duplicate && await this.validFile(duplicate)) {
        duplicate.accessedAt = Date.now();
        await this.writeIndex(index);
        return duplicate;
      }
      const number = index.next++;
      const label = (description.label ?? description.kind).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "capture";
      const fileName = `${number}-${label}.${dimensions.mediaType === "image/jpeg" ? "jpg" : "png"}`;
      const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
      const metadata: ScreenshotMetadata = {
        id: `screenshot-${number}`, fileName, kind: description.kind,
        target: description.target.slice(0, 2048), windowTitle: description.windowTitle?.slice(0, 512), pid: description.pid,
        width: dimensions.width, height: dimensions.height, bytes: bytes.length, sha256,
        createdAt: Date.now(), accessedAt: Date.now(),
      };
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        await rename(temporary, path.join(this.directory, fileName));
        index.items.push(metadata);
        index.items.sort((a, b) => a.accessedAt - b.accessedAt || a.createdAt - b.createdAt);
        while (index.items.length > this.maxCount || index.items.reduce((sum, item) => sum + item.bytes, 0) > this.maxBytes) {index.items.shift();}
        await this.writeIndex(index);
        await this.removeOrphans(index);
        return metadata;
      } finally {await rm(temporary, { force: true });}
    });
  }

  async lookup(id = "latest"): Promise<{ metadata: ScreenshotMetadata; bytes: Buffer; path: string } | undefined> {
    return this.lock(async () => {
      const index = await this.index();
      const item = id === "latest"
        ? [...index.items].sort((a, b) => b.createdAt - a.createdAt)[0]
        : index.items.find((item) => item.id === id);
      if (!item) {return undefined;}
      const bytes = await this.validFile(item);
      if (!bytes) {return undefined;}
      item.accessedAt = Date.now();
      await this.writeIndex(index);
      return { metadata: item, bytes, path: path.join(this.directory, item.fileName) };
    });
  }

  private lock<T>(operation: () => Promise<T>): Promise<T> {return withFileLock(path.join(this.historyRoot, ".mutations"), operation);}
  private async assertDirectory(): Promise<void> {
    for (const directory of [path.join(this.historyRoot, this.conversationId), this.directory]) {
      if ((await lstat(directory)).isSymbolicLink()) {throw new Error("Screenshot storage cannot use symbolic links");}
    }
  }
  private async index(): Promise<ScreenshotIndex> {
    try {
      await this.assertDirectory();
      const file = path.join(this.directory, "index.json");
      if ((await lstat(file)).isSymbolicLink()) {throw new Error("Screenshot index cannot be a symbolic link");}
      if ((await stat(file)).size > 512 * 1024) {throw new Error("Screenshot index is too large");}
      const index = JSON.parse(await readFile(file, "utf8")) as ScreenshotIndex;
      if (!Number.isSafeInteger(index.next) || index.next < 1 || !Array.isArray(index.items) || index.items.length > 1000 || !index.items.every(validMetadata)) {throw new Error("Corrupt screenshot index");}
      return index;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {return { next: 1, items: [] };}
      throw error;
    }
  }
  private writeIndex(index: ScreenshotIndex): Promise<void> {return writeJsonFileAtomic(path.join(this.directory, "index.json"), index);}
  private async validFile(item: ScreenshotMetadata): Promise<Buffer | undefined> {
    try {
      const file = path.join(this.directory, item.fileName);
      if ((await lstat(file)).isSymbolicLink()) {return undefined;}
      if ((await stat(file)).size !== item.bytes || item.bytes > 16 * 1024 * 1024) {return undefined;}
      const bytes = await readFile(file);
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) {return undefined;}
      inspectCapture(bytes);
      return bytes;
    } catch {return undefined;}
  }
  private async removeOrphans(index: ScreenshotIndex): Promise<void> {
    const keep = new Set(["index.json", ...index.items.map((item) => item.fileName)]);
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (entry.isFile() && !keep.has(entry.name)) {await rm(path.join(this.directory, entry.name), { force: true });}
    }
  }
}
function validMetadata(item: ScreenshotMetadata): boolean {
  return !!item && /^screenshot-\d+$/.test(item.id) && /^\d+-[A-Za-z0-9_-]+\.(png|jpg)$/.test(item.fileName) &&
    ["web", "window", "debug", "screen"].includes(item.kind) && typeof item.target === "string" &&
    Number.isSafeInteger(item.width) && item.width > 0 && Number.isSafeInteger(item.height) && item.height > 0 &&
    Number.isSafeInteger(item.bytes) && item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256) &&
    Number.isFinite(item.createdAt) && Number.isFinite(item.accessedAt);
}

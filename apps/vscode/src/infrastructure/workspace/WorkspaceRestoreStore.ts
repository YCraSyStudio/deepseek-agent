import { constants, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, symlink, unlink } from "node:fs/promises";
import * as path from "node:path";
import { getUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { withFileLock, writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { captureWorkspaceSnapshot, isWorkspaceSnapshot, snapshotFilePath, WorkspaceSnapshotStore, type SnapshotRoot, type WorkspaceSnapshot } from "./WorkspaceSnapshot";
import { assertSnapshotCapacity } from "./SnapshotCapacity";

interface SavedTurn {
  version: 1;
  generationId: string;
  createdAt: number;
  roots: SnapshotRoot[];
  before: WorkspaceSnapshot;
  after?: WorkspaceSnapshot;
  reverted?: boolean;
}
export interface WorkspaceTurnReview { generationId: string; paths: string[]; reverted: boolean }

/** Real, independent file copies. JSON is auxiliary indexing, never the recovery data. */
export class WorkspaceRestoreStore {
  private readonly state: WorkspaceSnapshotStore;
  private readonly metadata: string;
  constructor(conversationId: string, private readonly root = getUserDataDirectory(), private readonly limitMb = 1024) {
    this.state = new WorkspaceSnapshotStore(conversationId, root);
    this.metadata = path.join(this.state.directory, ".snapshot");
    this.conversationId = conversationId;
  }
  private readonly conversationId: string;

  async begin(generationId: string, roots: SnapshotRoot[], overrides: ReadonlyMap<string, string>, signal?: AbortSignal): Promise<{ previous?: WorkspaceSnapshot; current: WorkspaceSnapshot }> {
    return withFileLock(path.join(this.root, "snapshoots", ".capacity"), () => this.beginUnlocked(generationId, roots, overrides, signal));
  }

  private async beginUnlocked(generationId: string, roots: SnapshotRoot[], overrides: ReadonlyMap<string, string>, signal?: AbortSignal): Promise<{ previous?: WorkspaceSnapshot; current: WorkspaceSnapshot }> {
    const turnDirectory = this.turnDirectory(generationId);
    const temporary = await this.temporaryDirectory();
    try {
      const current = await captureWorkspaceSnapshot(roots, overrides, signal, path.join(temporary, "before"), undefined,
        (bytes) => assertSnapshotCapacity(this.root, this.limitMb, bytes));
      let previous: WorkspaceSnapshot | undefined;
      await this.commit(async () => {
        previous = await this.state.load();
        await mkdir(path.dirname(turnDirectory), { recursive: true, mode: 0o700 });
        if (await exists(turnDirectory)) {throw new Error("A recovery snapshot already exists for this turn");}
        await rename(temporary, turnDirectory);
        await writeJsonFileAtomic(path.join(turnDirectory, "turn.json"), {
          version: 1, generationId, createdAt: Date.now(), roots, before: current,
        } satisfies SavedTurn);
        await this.updateMirror(previous, current, path.join(turnDirectory, "before"), roots);
      });
      return { previous, current };
    } finally {await rm(temporary, { recursive: true, force: true });}
  }

  async finish(generationId: string, roots: SnapshotRoot[], overrides: ReadonlyMap<string, string>): Promise<void> {
    return withFileLock(path.join(this.root, "snapshoots", ".capacity"), () => this.finishUnlocked(generationId, roots, overrides));
  }

  private async finishUnlocked(generationId: string, roots: SnapshotRoot[], overrides: ReadonlyMap<string, string>): Promise<void> {
    const temporary = await this.temporaryDirectory();
    try {
      const turn = await this.readTurn(generationId, roots);
      const after = await captureWorkspaceSnapshot(roots, overrides);
      const changed = changedPaths(turn.before, after);
      if (changed.length) {
        const copied = await captureWorkspaceSnapshot(roots, overrides, undefined, temporary, new Set(changed),
          (bytes) => assertSnapshotCapacity(this.root, this.limitMb, bytes));
        for (const label of changed) {
          if (copied.files[label] !== after.files[label]) {throw new Error("The workspace changed while its recovery copy was being created");}
        }
      }
      await this.commit(async () => {
        const directory = this.turnDirectory(generationId);
        const previous = await this.state.load();
        await this.updateMirror(previous, after, temporary, roots);
        if (!changed.length) {await rm(directory, { recursive: true, force: true }); return;}
        const afterDirectory = path.join(directory, "after");
        await rename(temporary, afterDirectory);
        await writeJsonFileAtomic(path.join(directory, "turn.json"), { ...turn, after });
        // Only changed files need historic copies; the chat root remains a full mirror.
        const keep = new Set(changed);
        for (const label of Object.keys(turn.before.files)) {
          if (!keep.has(label)) {
            const file = snapshotFilePath(path.join(directory, "before"), label, roots);
            await unlink(file);
            await removeEmptyParents(file, [{ uri: "snapshot", alias: "snapshot", localPath: path.join(directory, "before") }]);
          }
        }
      });
    } finally {await rm(temporary, { recursive: true, force: true });}
  }

  async review(roots: SnapshotRoot[], generationId?: string): Promise<WorkspaceTurnReview> {
    const turn = await this.selectTurn(roots, generationId);
    if (!turn.after) {throw new Error("This turn has not finished capturing its changes");}
    return { generationId: turn.generationId, paths: changedPaths(turn.before, turn.after), reverted: !!turn.reverted };
  }

  async diff(roots: SnapshotRoot[], generationId: string, label: string): Promise<{ before: string; after: string }> {
    const turn = await this.readTurn(generationId, roots);
    if (!turn.after || !changedPaths(turn.before, turn.after).includes(label)) {throw new Error("No saved change for this file");}
    const read = async (side: "before" | "after"): Promise<string> => {
      const snapshot = turn[side]!;
      const hash = snapshot.files[label];
      if (!hash) {return "";}
      const file = snapshotFilePath(path.join(this.turnDirectory(generationId), side), label, roots);
      await assertCopyParents(this.turnDirectory(generationId), file);
      if (await fingerprint(file) !== hash) {throw new Error("The recovery copy is missing or has changed");}
      if (hash.startsWith("link:")) {return `Symlink: ${await readlink(file)}`;}
      const bytes = await readFile(file);
      if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) {throw new Error("This file is binary or too large for a text review; its recovery copy is still available");}
      return bytes.toString("utf8");
    };
    return { before: await read("before"), after: await read("after") };
  }

  async revert(roots: SnapshotRoot[], generationId?: string, assertWritable: (paths: string[]) => void = () => undefined): Promise<WorkspaceTurnReview> {
    return this.commit(async () => {
      const turn = await this.selectTurn(roots, generationId);
      if (!turn.after) {throw new Error("This turn has no completed recovery snapshot");}
      const paths = changedPaths(turn.before, turn.after);
      if (turn.reverted) {return { generationId: turn.generationId, paths, reverted: true };}
      const operations: Array<{ label: string; target: string; before?: string; after?: string }> = [];
      for (const label of paths) {
        const target = workspaceFilePath(label, roots);
        await assertSafeParents(target, roots);
        const current = await fingerprint(target);
        const before = turn.before.files[label];
        const after = turn.after.files[label];
        if (current !== after && current !== before) {throw new Error(`Cannot revert ${label}: it has changed since this turn. No files were reverted.`);}
        for (const [side, hash] of [["before", before], ["after", after]] as const) {
          const backup = snapshotFilePath(path.join(this.turnDirectory(turn.generationId), side), label, roots);
          await assertCopyParents(this.turnDirectory(turn.generationId), backup);
          if (hash && await fingerprint(backup) !== hash) {
            throw new Error(`Recovery copy is missing or corrupt for ${label}. No files were reverted.`);
          }
        }
        if (current !== before) {operations.push({ label, target, before, after });}
      }
      assertWritable(paths.map((label) => workspaceFilePath(label, roots)));
      const applied: typeof operations = [];
      try {
        for (const operation of operations) {
          assertWritable([operation.target]);
          await assertSafeParents(operation.target, roots);
          if (await fingerprint(operation.target) !== operation.after) {throw new Error(`Cannot revert ${operation.label}: it changed during restoration`);}
          await replaceEntry(operation.target, operation.before ? snapshotFilePath(path.join(this.turnDirectory(turn.generationId), "before"), operation.label, roots) : undefined);
          applied.push(operation);
        }
      } catch (error) {
        for (const operation of applied.reverse()) {
          await assertSafeParents(operation.target, roots);
          if (await fingerprint(operation.target) === operation.before) {
            await replaceEntry(operation.target, operation.after ? snapshotFilePath(path.join(this.turnDirectory(turn.generationId), "after"), operation.label, roots) : undefined);
          }
        }
        throw error;
      }
      await writeJsonFileAtomic(path.join(this.turnDirectory(turn.generationId), "turn.json"), { ...turn, reverted: true });
      for (const operation of operations.filter((item) => !item.before)) {await removeEmptyParents(operation.target, roots);}
      // Keep the last observed state: the next user message must tell DeepSeek about this revert.
      return { generationId: turn.generationId, paths, reverted: true };
    });
  }

  private async updateMirror(previous: WorkspaceSnapshot | undefined, current: WorkspaceSnapshot, source: string, roots: SnapshotRoot[]): Promise<void> {
    if (previous && (previous.roots.join("\0") !== current.roots.join("\0") || Object.keys(previous.files).some((label) => !roots.some((root) => label.startsWith(`${root.alias}/`))))) {
      for (const entry of await readdir(this.state.directory)) {
        if (entry !== ".snapshot") {await rm(path.join(this.state.directory, entry), { recursive: true, force: true });}
      }
      previous = undefined;
    }
    for (const label of Object.keys(previous?.files ?? {})) {
      if (!Object.hasOwn(current.files, label) && previous?.roots.join("\0") === current.roots.join("\0")) {
        const file = snapshotFilePath(this.state.directory, label, roots);
        await assertCopyParents(this.state.directory, file);
        await unlink(file).catch((error: NodeJS.ErrnoException) => {if (error.code !== "ENOENT") {throw error;}});
        await removeEmptyParents(file, [{ uri: "snapshot", alias: "snapshot", localPath: this.state.directory }]);
      }
    }
    for (const label of Object.keys(current.files)) {
      if (previous?.files[label] === current.files[label] && await fingerprint(snapshotFilePath(this.state.directory, label, roots)) === current.files[label]) {continue;}
      const target = snapshotFilePath(this.state.directory, label, roots);
      await assertCopyParents(this.state.directory, target);
      await replaceEntry(target, snapshotFilePath(source, label, roots));
    }
    await writeJsonFileAtomic(path.join(this.metadata, "state.json"), current);
  }

  private turnDirectory(generationId: string): string {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(generationId)) {throw new Error("Invalid recovery turn id");}
    return path.join(this.metadata, "turns", generationId);
  }

  private async readTurn(generationId: string, roots: SnapshotRoot[]): Promise<SavedTurn> {
    const directory = this.turnDirectory(generationId);
    await assertCopyParents(this.state.directory, path.join(directory, "turn.json"));
    const file = path.join(directory, "turn.json");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) {throw new Error("Invalid recovery manifest");}
    const turn = JSON.parse(await readFile(file, "utf8")) as SavedTurn;
    if (turn.version !== 1 || turn.generationId !== generationId || !Number.isSafeInteger(turn.createdAt) ||
      JSON.stringify(turn.roots) !== JSON.stringify(roots) || !isWorkspaceSnapshot(turn.before) ||
      (turn.after !== undefined && !isWorkspaceSnapshot(turn.after))) {throw new Error("The recovery snapshot belongs to a different workspace or is invalid");}
    for (const snapshot of [turn.before, turn.after]) {
      for (const label of Object.keys(snapshot?.files ?? {})) {snapshotFilePath(directory, label, roots);}
    }
    return turn;
  }

  private async selectTurn(roots: SnapshotRoot[], generationId?: string): Promise<SavedTurn> {
    if (generationId) {return this.readTurn(generationId, roots);}
    const entries = await readdir(path.join(this.metadata, "turns"), { withFileTypes: true }).catch(() => []);
    const turns: SavedTurn[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {continue;}
      const turn = await this.readTurn(entry.name, roots);
      if (turn.after && !turn.reverted && changedPaths(turn.before, turn.after).length) {turns.push(turn);}
    }
    turns.sort((a, b) => b.createdAt - a.createdAt);
    if (!turns[0]) {throw new Error("No completed changes are available to revert in this chat");}
    return turns[0];
  }

  private async temporaryDirectory(): Promise<string> {
    const directory = path.join(this.root, "snapshoots", `.pending-${randomUUID()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  private async commit<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(path.join(this.root, "history", ".mutations"), async () => {
      const manifest = await lstat(path.join(this.root, "history", this.conversationId, "manifest.json"));
      if (!manifest.isFile() || manifest.isSymbolicLink()) {throw new Error("The snapshot chat is unavailable");}
      await assertCopyParents(path.join(this.root, "snapshoots"), path.join(this.metadata, "state.json"));
      return operation();
    });
  }
}

function changedPaths(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter((label) => before.files[label] !== after.files[label]).sort();
}
function workspaceFilePath(label: string, roots: SnapshotRoot[]): string {
  const root = roots.find((item) => label.startsWith(`${item.alias}/`));
  if (!root) {throw new Error("Unknown snapshot workspace root");}
  return snapshotFilePath(root.localPath, label, [root]);
}
async function fingerprint(file: string): Promise<string | undefined> {
  try {
    const info = await lstat(file);
    const hash = createHash("sha256");
    if (info.isSymbolicLink()) {return `link:${hash.update(await readlink(file)).digest("hex")}`;}
    if (!info.isFile()) {throw new Error(`Cannot restore over a directory or special file: ${file}`);}
    for await (const chunk of createReadStream(file)) {hash.update(chunk);}
    return `${info.mode & 0o111}:${hash.digest("hex")}`;
  } catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") {return undefined;} throw error;}
}
async function exists(file: string): Promise<boolean> {
  try {await lstat(file); return true;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") {return false;} throw error;}
}
async function assertCopyParents(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {throw new Error("Recovery path escapes its root");}
  let parent = root;
  for (const part of ["", ...relative.split(path.sep).slice(0, -1)]) {
    if (part) {parent = path.join(parent, part);}
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) {throw new Error("Recovery paths cannot traverse symlinks or files");}
    } catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;}}
  }
}
async function assertSafeParents(target: string, roots: SnapshotRoot[]): Promise<void> {
  const root = roots.find((item) => target.startsWith(`${path.resolve(item.localPath)}${path.sep}`));
  if (!root) {throw new Error("Recovery target is outside the bound workspace");}
  await assertCopyParents(root.localPath, target);
}
async function replaceEntry(target: string, source?: string): Promise<void> {
  if (!source) {await unlink(target).catch((error: NodeJS.ErrnoException) => {if (error.code !== "ENOENT") {throw error;}}); return;}
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.ycrasy-revert-${randomUUID()}`);
  try {
    const info = await lstat(source);
    if (info.isSymbolicLink()) {await symlink(await readlink(source), temporary);}
    else {
      await copyFile(source, temporary, constants.COPYFILE_FICLONE);
      await chmod(temporary, info.mode & 0o777);
    }
    await rename(temporary, target);
  } finally {await rm(temporary, { force: true });}
}
async function removeEmptyParents(file: string, roots: SnapshotRoot[]): Promise<void> {
  let directory = path.dirname(file);
  while (!roots.some((root) => path.resolve(root.localPath) === directory)) {
    try {await rmdir(directory);}
    catch {return;}
    directory = path.dirname(directory);
  }
}

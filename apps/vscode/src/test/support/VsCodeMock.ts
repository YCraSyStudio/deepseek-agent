/** Deterministic VS Code boundary. Filesystem operations use real temporary files. */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

class EventSource<T> {
  private readonly listeners = new Set<(event: T) => void>();
  event = (listener: (event: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };
  fire(event: T) { for (const listener of [...this.listeners]) { listener(event); } }
  clear() { this.listeners.clear(); }
}

interface TestUri { scheme: string; fsPath: string; path?: string; authority?: string; toString(): string }
interface TestFolder { uri: TestUri; name: string }

export const dialogs = {
  warning: undefined as string | undefined,
  information: undefined as string | undefined,
  warnings: [] as unknown[][],
  informationMessages: [] as unknown[][],
  errors: [] as unknown[][],
  reset() { this.warning = undefined; this.information = undefined; this.warnings = []; this.informationMessages = []; this.errors = []; },
};
export const hostEvents = {
  folders: new EventSource<void>(),
  focus: new EventSource<{ focused: boolean }>(),
  visibility: new EventSource<void>(),
  closedDocument: new EventSource<{ uri: TestUri }>(),
};
export const hostState = {
  selectedFolders: undefined as TestUri[] | undefined,
  quickPick: undefined as string | undefined,
  cancellations: [] as Array<{ token: { isCancellationRequested: boolean }; disposed: boolean }>,
  findFiles: async (_pattern: RelativePattern, _exclude: unknown, _max: number, _token: { isCancellationRequested: boolean }): Promise<TestUri[]> => { throw new Error("Supply a workspace search fixture"); },
  opened: [] as TestUri[],
  executed: [] as string[],
  commandCalls: [] as Array<{ command: string; args: unknown[] }>,
  commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  textProviders: new Map<string, unknown>(),
  copied: [] as string[],
  watchers: [] as TestWatcher[],
  decorations: [] as Array<{ options: unknown; disposed: boolean }>,
  openError: undefined as Error | undefined,
  stat: async (uri: TestUri): Promise<{ type: number; size?: number }> => {
    const info = await stat(uri.fsPath);
    return { type: info.isFile() ? FileType.File : FileType.Directory, size: info.size };
  },
};
const defaultStat = hostState.stat;

export const window = {
  visibleTextEditors: [] as Array<{ document: unknown; edit: (...args: unknown[]) => Promise<boolean> }>,
  activeTextEditor: undefined as { document: { uri: TestUri } & Record<string, unknown>; selection?: unknown } | undefined,
  onDidChangeWindowState: hostEvents.focus.event,
  async showTextDocument(document: { uri: TestUri }) {
    if (hostState.openError) { throw hostState.openError; }
    hostState.opened.push(document.uri);
  },
  async showOpenDialog() { return hostState.selectedFolders; },
  async showQuickPick() { return hostState.quickPick; },
  async showWarningMessage(...args: unknown[]) { dialogs.warnings.push(args); return dialogs.warning; },
  async showInformationMessage(...args: unknown[]) { dialogs.informationMessages.push(args); return dialogs.information; },
  async showErrorMessage(...args: unknown[]) { dialogs.errors.push(args); },
  tabGroups: { activeTabGroup: { activeTab: undefined as { input?: unknown } | undefined } },
  createTextEditorDecorationType(options: unknown) {
    const decoration = { options, disposed: false, dispose() { decoration.disposed = true; } };
    hostState.decorations.push(decoration);
    return decoration;
  },
};
export const commands = {
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> { hostState.executed.push(command); hostState.commandCalls.push({ command, args }); return hostState.commandHandlers.get(command)?.(...args); },
  registerCommand(command: string, handler: (...args: unknown[]) => unknown) { hostState.commandHandlers.set(command, handler); return { dispose: () => { hostState.commandHandlers.delete(command); } }; },
};
interface TestDebugSession { id: string; configuration: Record<string, unknown> }
interface TestDebugTrackerFactory {
  createDebugAdapterTracker(session: TestDebugSession): { onDidSendMessage(message: unknown): void };
}
const debugTerminated = new EventSource<TestDebugSession>();
export const debug = {
  activeDebugSession: undefined as TestDebugSession | undefined,
  trackerFactories: new Map<string, TestDebugTrackerFactory>(),
  registerDebugAdapterTrackerFactory(kind: string, factory: TestDebugTrackerFactory) {
    this.trackerFactories.set(kind, factory);
    return { dispose: () => { this.trackerFactories.delete(kind); } };
  },
  onDidTerminateDebugSession: debugTerminated.event,
  terminate(session: TestDebugSession) { debugTerminated.fire(session); },
};
export const env = { language: "en", clipboard: { async writeText(text: string) { hostState.copied.push(text); } } };
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
export class FileSystemError extends Error { constructor(public code: string) { super(code); } }
export const Uri = {
  file(file: string): TestUri { return { scheme: "file", authority: "", path: file.replaceAll("\\", "/"), fsPath: file, toString: () => pathToFileURL(file).href }; },
  from(value: { scheme: string; path: string }): TestUri { return { scheme: value.scheme, authority: "", path: value.path, fsPath: value.path, toString: () => `${value.scheme}:${value.path}` }; },
  parse(value: string): TestUri { const parsed = new URL(value); return parsed.protocol === "file:" ? Uri.file(fileURLToPath(parsed)) : { scheme: parsed.protocol.slice(0, -1), authority: parsed.host, path: parsed.pathname, fsPath: parsed.pathname, toString: () => value }; },
  joinPath(base: TestUri, ...parts: string[]): TestUri {
    if (base.scheme === "file") { return Uri.file(path.join(base.fsPath, ...parts)); }
    const joined = path.posix.join(base.path ?? base.fsPath, ...parts);
    return { scheme: base.scheme, authority: base.authority ?? "", path: joined, fsPath: joined, toString: () => `${base.scheme}:${base.authority ? `//${base.authority}` : ""}${joined}` };
  },
};
export class Position { constructor(public line: number, public character: number) {} }
export class Range {
  start: Position;
  end: Position;
  constructor(start: Position | number, end: Position | number, endLine?: number, endCharacter?: number) {
    if (typeof start === "number" && typeof end === "number" && endLine !== undefined && endCharacter !== undefined) {
      this.start = new Position(start, end);
      this.end = new Position(endLine, endCharacter);
    } else {
      this.start = start as Position;
      this.end = end as Position;
    }
  }
}
export class RelativePattern { constructor(public base: TestUri, public pattern: string) {} }
export class Disposable {
  constructor(private readonly cleanup: () => void) {}
  dispose() { this.cleanup(); }
  static from(...items: Array<{ dispose(): void }>) { return new Disposable(() => items.forEach((item) => item.dispose())); }
}
class TestWatcher {
  readonly created = new EventSource<void>();
  readonly changed = new EventSource<void>();
  readonly deleted = new EventSource<void>();
  readonly onDidCreate = this.created.event;
  readonly onDidChange = this.changed.event;
  readonly onDidDelete = this.deleted.event;
  disposed = false;
  constructor(readonly pattern: RelativePattern) {}
  dispose() { this.disposed = true; this.created.clear(); this.changed.clear(); this.deleted.clear(); }
}
const defaultFindFiles = hostState.findFiles;
export const workspace = {
  findFiles: (pattern: RelativePattern, exclude: unknown, max: number, token: { isCancellationRequested: boolean }) => hostState.findFiles(pattern, exclude, max, token),
  workspaceFolders: undefined as TestFolder[] | undefined,
  workspaceFile: undefined as TestUri | undefined,
  name: undefined as string | undefined,
  isTrusted: true,
  textDocuments: [] as Array<{ uri: TestUri; isDirty: boolean; getText(): string }>,
  fs: {
    stat: (uri: TestUri) => hostState.stat(uri), readFile: (uri: TestUri) => readFile(uri.fsPath),
    createDirectory: async (uri: TestUri) => { await mkdir(uri.fsPath, { recursive: true }); },
    writeFile: (uri: TestUri, content: Uint8Array) => writeFile(uri.fsPath, content),
    rename: async (source: TestUri, destination: TestUri, options: { overwrite?: boolean } = {}) => {
      if (!options.overwrite) { await stat(destination.fsPath).then(() => { throw Object.assign(new Error("Destination already exists"), { code: "EEXIST" }); }, (error) => { if (error.code !== "ENOENT") { throw error; } }); }
      await rename(source.fsPath, destination.fsPath);
    },
    delete: (uri: TestUri, options: { recursive?: boolean } = {}) => rm(uri.fsPath, { recursive: options.recursive, force: true }),
    readDirectory: async (uri: TestUri) => (await readdir(uri.fsPath, { withFileTypes: true })).map((entry) => [entry.name, entry.isDirectory() ? FileType.Directory : FileType.File]),
  },
  registerTextDocumentContentProvider: (scheme: string, provider: unknown) => { hostState.textProviders.set(scheme, provider); return { dispose: () => { hostState.textProviders.delete(scheme); } }; },
  onDidCloseTextDocument: hostEvents.closedDocument.event,
  getWorkspaceFolder: (uri: TestUri) => workspace.workspaceFolders?.find((folder) => uri.fsPath === folder.uri.fsPath || uri.fsPath.startsWith(`${folder.uri.fsPath}${path.sep}`)),
  createFileSystemWatcher: (pattern: RelativePattern) => {
    const watcher = new TestWatcher(pattern); hostState.watchers.push(watcher); return watcher;
  },
  onDidChangeWorkspaceFolders: hostEvents.folders.event,
  openTextDocument: async (uri: TestUri) => ({ uri }),
};

export function resetVsCodeMock() {
  dialogs.reset();
  debug.activeDebugSession = undefined; debug.trackerFactories.clear(); debugTerminated.clear();
  workspace.workspaceFolders = undefined; workspace.workspaceFile = undefined; workspace.name = undefined; workspace.isTrusted = true; workspace.textDocuments = [];
  window.activeTextEditor = undefined; window.visibleTextEditors = [];
  window.tabGroups.activeTabGroup.activeTab = undefined;
  env.language = "en";
  hostState.selectedFolders = undefined; hostState.quickPick = undefined;
  hostState.cancellations = []; hostState.findFiles = defaultFindFiles;
  hostState.opened = [];
  hostState.executed = [];
  hostState.commandCalls = []; hostState.commandHandlers.clear(); hostState.textProviders.clear(); hostState.copied = [];
  hostState.watchers.forEach((watcher) => watcher.dispose());
  hostState.watchers = [];
  hostState.decorations = [];
  hostState.openError = undefined;
  hostState.stat = defaultStat;
  hostEvents.folders.clear(); hostEvents.focus.clear(); hostEvents.visibility.clear(); hostEvents.closedDocument.clear();
}

export const OverviewRulerLane = { Right: 4 };
export const TextEditorRevealType = { InCenter: 1 };
export const SymbolKind: Record<number, string> = { 4: "Class", 5: "Method", 11: "Function", 12: "Variable" };
export class SymbolInformation {}
export class TabInputTextDiff { constructor(public original: TestUri, public modified: TestUri) {} }
export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;
  constructor(anchor: Position, active: Position) { super(anchor, active); this.anchor = anchor; this.active = active; }
  get isEmpty() { return this.anchor.line === this.active.line && this.anchor.character === this.active.character; }
}
export class CancellationTokenSource {
  disposed = false;
  constructor() { hostState.cancellations.push(this); }
  private readonly changed = new EventSource<void>();
  readonly token = { isCancellationRequested: false, onCancellationRequested: this.changed.event };
  cancel() { this.token.isCancellationRequested = true; this.changed.fire(); }
  dispose() { this.disposed = true; this.changed.clear(); }
}
export class WorkspaceEdit {
  replace(): never { throw new Error("Unexpected editor mutation in a handler test; supply a real editor fixture."); }
}

import { createHash } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  WorkspaceBinding,
  WorkspaceConnectionState,
  WorkspaceContextStatus,
  WorkspaceFolderBinding,
} from "@/contracts";

const MAX_ACTIVE_EDITOR_CAPTURE_CHARACTERS = 32 * 1024;

export interface WorkspaceRunSnapshot {
  binding: WorkspaceBinding;
  folders: ReadonlyArray<WorkspaceFolderSnapshot>;
  defaultFolderAlias?: string;
  activeEditor?: CapturedEditorSnapshot;
}

export interface WorkspaceFolderSnapshot extends WorkspaceFolderBinding {
  rootUri: vscode.Uri;
  localPath?: string;
}

interface CapturedEditorSnapshot {
  uri: string;
  workspacePath: string;
  content: string;
  languageId: string;
  rangeLabel: string;
}

export function captureCurrentWorkspaceBinding(): WorkspaceBinding {
  const folders = createFolderBindings(vscode.workspace.workspaceFolders ?? []);
  const workspaceFile = vscode.workspace.workspaceFile;
  const uri = workspaceFile?.toString() ??
    (folders.length === 1 ? folders[0]!.uri : createLogicalWorkspaceUri(folders));
  const name = vscode.workspace.name?.trim() ||
    (folders.length === 1 ? folders[0]!.name : folders.length > 1 ? "VS Code Workspace" : "No workspace");
  return createBinding(uri, name, folders);
}

export function resolveWorkspaceContext(binding: WorkspaceBinding): WorkspaceContextStatus {
  const current = captureCurrentWorkspaceBinding();
  let state: WorkspaceConnectionState;
  if (binding.folders.length === 0 && current.folders.length === 0) {
    state = "empty";
  } else if (binding.folders.length === 0) {
    state = "changed";
  } else if (binding.uri !== current.uri) {
    state = "disconnected";
  } else if (binding.revision !== current.revision) {
    state = "changed";
  } else {
    state = "connected";
  }
  return {
    binding,
    state,
    defaultFolderAlias: state === "connected" ? getActiveEditorFolderAlias(binding) : undefined,
  };
}

export function captureWorkspaceRunSnapshot(binding: WorkspaceBinding): WorkspaceRunSnapshot {
  const status = resolveWorkspaceContext(binding);
  if (status.state === "disconnected" || status.state === "changed") {
    throw new Error(getWorkspaceUnavailableMessage(status.state, binding.name));
  }
  const folders = binding.folders.map((folder) => {
    const rootUri = vscode.Uri.parse(folder.uri);
    return Object.freeze({
      ...folder,
      rootUri,
      localPath: rootUri.scheme === "file" ? rootUri.fsPath : undefined,
    });
  });
  const partialSnapshot: WorkspaceRunSnapshot = {
    binding: structuredClone(binding),
    folders: Object.freeze(folders),
    defaultFolderAlias: status.defaultFolderAlias,
  };
  const activeEditor = captureActiveEditor(partialSnapshot);
  return Object.freeze({ ...partialSnapshot, activeEditor });
}

function getWorkspaceUnavailableMessage(state: WorkspaceConnectionState, name: string): string {
  if (state === "changed") {
    return `Workspace "${name}" changed. Confirm the updated workspace before continuing.`;
  }
  if (state === "empty") {
    return "Open a workspace folder before using project tools.";
  }
  return `Workspace "${name}" is not open. Open it or reassign the conversation before continuing.`;
}

export function findSnapshotFolderForUri(snapshot: WorkspaceRunSnapshot, uri: vscode.Uri): WorkspaceFolderSnapshot | undefined {
  return snapshot.folders.find((folder) => isUriInsideRoot(uri, folder.rootUri));
}

export function formatWorkspacePath(snapshot: WorkspaceRunSnapshot, uri: vscode.Uri): string | undefined {
  const folder = findSnapshotFolderForUri(snapshot, uri);
  if (!folder) {
    return undefined;
  }
  const relative = relativeUriPath(folder.rootUri, uri);
  const pathValue = snapshot.folders.length > 1
    ? `${folder.alias}${relative ? `/${relative}` : ""}`
    : relative || ".";
  return `./${pathValue}`;
}

export function isUriInsideRoot(candidate: vscode.Uri, root: vscode.Uri): boolean {
  if (candidate.scheme !== root.scheme || candidate.authority !== root.authority) {
    return false;
  }
  const relative = relativeUriPath(root, candidate);
  return relative !== undefined;
}

function relativeUriPath(root: vscode.Uri, candidate: vscode.Uri): string | undefined {
  const relative = root.scheme === "file"
    ? path.relative(root.fsPath, candidate.fsPath)
    : path.posix.relative(root.path, candidate.path);
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    relative.startsWith("..\\") ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.replace(/\\/g, "/");
}

function createFolderBindings(folders: readonly vscode.WorkspaceFolder[]): WorkspaceFolderBinding[] {
  const aliases = createUniqueAliases(folders.map((folder) => folder.name));
  return folders.map((folder, index) => ({
    uri: folder.uri.toString(),
    name: folder.name,
    alias: aliases[index]!,
    scheme: folder.uri.scheme,
  }));
}

function createUniqueAliases(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = normalizeAlias(name) || "root";
    let alias = base;
    let suffix = 2;
    while (used.has(alias.toLocaleLowerCase())) {
      alias = `${base}~${suffix++}`;
    }
    used.add(alias.toLocaleLowerCase());
    return alias;
  });
}

function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\\/\0]/g, "-").replace(/\s+/g, "-");
}

function createLogicalWorkspaceUri(folders: WorkspaceFolderBinding[]): string {
  if (folders.length === 0) {
    return "ycrasy-workspace:empty";
  }
  const digest = hash(folders.map((folder) => folder.uri).sort().join("\0"));
  return `ycrasy-workspace:untitled:${digest}`;
}

function createBinding(uri: string, name: string, folders: WorkspaceFolderBinding[]): WorkspaceBinding {
  const revision = hash(JSON.stringify({ uri, folders: folders.map(({ uri: folderUri, name: folderName, alias }) => ({ uri: folderUri, name: folderName, alias })) }));
  const hasFolders = folders.length > 0;
  const hasLocalFolder = folders.some((folder) => folder.scheme === "file");
  return {
    schemaVersion: 1,
    uri,
    name,
    revision,
    folders,
    capabilities: {
      files: hasFolders,
      search: hasFolders,
      git: hasLocalFolder,
      terminal: hasLocalFolder,
    },
  };
}

function getActiveEditorFolderAlias(binding: WorkspaceBinding): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (!activeUri) {
    return undefined;
  }
  return binding.folders.find((folder) => isUriInsideRoot(activeUri, vscode.Uri.parse(folder.uri)))?.alias;
}

function captureActiveEditor(snapshot: WorkspaceRunSnapshot): CapturedEditorSnapshot | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isUntitled) {
    return undefined;
  }
  const workspacePath = formatWorkspacePath(snapshot, editor.document.uri);
  if (!workspacePath) {
    return undefined;
  }
  const selectionLength = editor.document.offsetAt(editor.selection.end) - editor.document.offsetAt(editor.selection.start);
  const hasSelection = selectionLength > 0;
  const targetStart = hasSelection ? editor.document.offsetAt(editor.selection.start) : 0;
  const targetEnd = hasSelection
    ? editor.document.offsetAt(editor.selection.end)
    : editor.document.offsetAt(new vscode.Position(editor.document.lineCount, 0));
  return Object.freeze({
    uri: editor.document.uri.toString(),
    workspacePath,
    content: readDocumentPreview(editor.document, targetStart, targetEnd),
    languageId: editor.document.languageId,
    rangeLabel: hasSelection
      ? `selection ${editor.selection.start.line + 1}:${editor.selection.start.character + 1}-${editor.selection.end.line + 1}:${editor.selection.end.character + 1}`
      : "active file",
  });
}

function readDocumentPreview(document: vscode.TextDocument, startOffset: number, endOffset: number): string {
  const length = Math.max(0, endOffset - startOffset);
  if (length <= MAX_ACTIVE_EDITOR_CAPTURE_CHARACTERS) {
    return document.getText(new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)));
  }
  const side = Math.floor(MAX_ACTIVE_EDITOR_CAPTURE_CHARACTERS / 2);
  const head = document.getText(new vscode.Range(document.positionAt(startOffset), document.positionAt(startOffset + side)));
  const tail = document.getText(new vscode.Range(document.positionAt(endOffset - side), document.positionAt(endOffset)));
  return `${head}\n...[active editor middle omitted]...\n${tail}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

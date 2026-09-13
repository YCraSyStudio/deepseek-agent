import * as path from "node:path";
import { open, realpath } from "node:fs/promises";
import * as vscode from "vscode";
import type {
  DeleteWorkspacePathOptions,
  MoveWorkspacePathOptions,
  ToolHostDocumentSymbol,
  ToolWorkspaceEntryType,
  ToolWorkspaceFilePreview,
  ToolWorkspaceFindOptions,
  ToolWorkspaceHost,
  ToolWorkspaceStat,
} from "@/infrastructure/tools/ToolWorkspace";
import { resolveWorkspacePathSecure } from "@/infrastructure/tools/ToolWorkspace";
import {
  captureCurrentWorkspaceBinding,
  captureWorkspaceRunSnapshot,
  type WorkspaceRunSnapshot,
} from "@/vscode/workspace";
import { createInlineDiffPreview } from "./InlineDiffPreview";
import { fileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";
import { executeInVsCodeTerminal, VSCODE_TERMINAL_SHELL_DESCRIPTION } from "./VsCodeTerminalExecution";
import {
  createAbortError,
  findFilesInRoot,
  formatLogicalPath,
  isVirtualWorkspaceRoot,
  resolveAllowedExternalPath,
  resolveAndValidateLogicalPath,
  resolveDefaultLocalFolder,
  resolveLogicalPath,
  resolveSearchPatterns,
  toEntryType,
  toLogicalUri,
  toRelativeWorkspacePath,
  toResolvedUri,
  validateResolvedPath,
} from "./WorkspacePathResolver";

export function createVsCodeToolWorkspace(
  capturedSnapshot?: WorkspaceRunSnapshot,
  options: { allowOutsideWorkspace?: boolean; unrestricted?: boolean } = {},
): ToolWorkspaceHost {
  const inlinePreview = createInlineDiffPreview();
  const snapshot = capturedSnapshot ?? captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding());
  const defaultFolder = snapshot.folders.find((folder) => folder.alias === snapshot.defaultFolderAlias);

  const resolveToolUri = async (rawPath: string, allowSensitive: boolean): Promise<vscode.Uri> => {
    const externalPath = resolveAllowedExternalPath(snapshot, rawPath, options.allowOutsideWorkspace === true);
    return externalPath
      ? vscode.Uri.file(externalPath)
      : toLogicalUri(await resolveAndValidateLogicalPath(snapshot, rawPath, allowSensitive || options.unrestricted === true));
  };

  return {
    getRootPath(): string | undefined {
      return defaultFolder?.localPath ?? (snapshot.folders.length === 1 ? snapshot.folders[0]?.localPath : undefined);
    },

    getWorkspaceId(): string {
      return options.unrestricted === true ? "computer:unrestricted" : snapshot.binding.uri;
    },

    getCommandShell(): string {
      return VSCODE_TERMINAL_SHELL_DESCRIPTION;
    },

    executeCommand: executeInVsCodeTerminal,

    async isPathInsideWorkspace(rawPath: string): Promise<boolean> {
      if (path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath)) {
        for (const folder of snapshot.folders) {
          if (!folder.localPath) {
            continue;
          }
          try {
            await resolveWorkspacePathSecure(rawPath, folder.localPath, realpath, { allowSensitive: true });
            return true;
          } catch {
          }
        }
        return false;
      }
      try {
        const resolved = resolveLogicalPath(snapshot, rawPath);
        await validateResolvedPath(resolved, true);
        return true;
      } catch {
        return false;
      }
    },

    async resolvePath(rawPath: string, allowSensitive: boolean): Promise<string> {
      const externalPath = resolveAllowedExternalPath(snapshot, rawPath, options.allowOutsideWorkspace === true);
      if (externalPath) {
        return externalPath;
      }
      if (isVirtualWorkspaceRoot(snapshot, rawPath)) {
        return ".";
      }
      const resolved = resolveLogicalPath(snapshot, rawPath);
      await validateResolvedPath(resolved, allowSensitive || options.unrestricted === true);
      return resolved.logicalPath;
    },

    async resolveLocalPath(rawPath?: string) {
      const externalPath = rawPath
        ? resolveAllowedExternalPath(snapshot, rawPath, options.allowOutsideWorkspace === true)
        : undefined;
      if (externalPath) {
        const absolutePath = await realpath(externalPath);
        const workspaceRoot = defaultFolder?.localPath ?? snapshot.folders.find((folder) => folder.localPath)?.localPath;
        if (!workspaceRoot) {
          throw new Error("A local workspace root is required for terminal execution.");
        }
        return { absolutePath, relativePath: externalPath, workspaceRoot };
      }
      const resolved = rawPath
        ? resolveLogicalPath(snapshot, rawPath)
        : resolveDefaultLocalFolder(snapshot);
      if (!resolved.folder.localPath) {
        throw new Error(`Terminal is unavailable for workspace root "${resolved.folder.alias}".`);
      }
      const localPath = await resolveWorkspacePathSecure(resolved.relativePath, resolved.folder.localPath, realpath, { allowSensitive: true });
      return { ...localPath, workspaceRoot: resolved.folder.localPath };
    },

    realPath(absolutePath: string): Promise<string> {
      return realpath(absolutePath);
    },

    async findFiles(options: ToolWorkspaceFindOptions): Promise<string[]> {
      if (options.signal?.aborted) {
        throw createAbortError();
      }
      const searches = resolveSearchPatterns(snapshot, options.includePattern);
      const results: string[] = [];
      for (const search of searches) {
        const remaining = Math.max(0, options.maxResults - results.length);
        if (remaining === 0) {
          break;
        }
        const resources = await findFilesInRoot(search.folder.rootUri, search.pattern, remaining, options.signal);
        results.push(...resources.map((resource) => formatLogicalPath(snapshot, search.folder, toRelativeWorkspacePath(search.folder.rootUri, resource))));
      }
      return results;
    },

    async readFile(relativePath: string): Promise<Uint8Array> {
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const uri = externalPath
        ? vscode.Uri.file(externalPath)
        : toLogicalUri(await resolveAndValidateLogicalPath(snapshot, relativePath, options.unrestricted === true));
      const openDocument = findOpenTextDocument(uri);
      return openDocument
        ? Buffer.from(openDocument.getText(), "utf8")
        : vscode.workspace.fs.readFile(uri);
    },

    async readFilePreview(relativePath: string, maxBytes: number): Promise<ToolWorkspaceFilePreview> {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error("File preview size must be a positive integer");
      }
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const uri = externalPath
        ? vscode.Uri.file(externalPath)
        : toLogicalUri(await resolveAndValidateLogicalPath(snapshot, relativePath, options.unrestricted === true));
      const metadata = await vscode.workspace.fs.stat(uri);
      if (metadata.size <= maxBytes) {
        return { head: await vscode.workspace.fs.readFile(uri), size: metadata.size };
      }
      if (uri.scheme !== "file") {
        const content = await vscode.workspace.fs.readFile(uri);
        return { head: content.slice(0, maxBytes), size: metadata.size };
      }

      const headLength = Math.ceil(maxBytes / 2);
      const tailLength = Math.floor(maxBytes / 2);
      const file = await open(uri.fsPath, "r");
      try {
        const head = Buffer.alloc(headLength);
        const tail = Buffer.alloc(tailLength);
        const headRead = await file.read(head, 0, headLength, 0);
        const tailRead = await file.read(tail, 0, tailLength, Math.max(0, metadata.size - tailLength));
        return {
          head: head.subarray(0, headRead.bytesRead),
          tail: tail.subarray(0, tailRead.bytesRead),
          size: metadata.size,
        };
      } finally {
        await file.close();
      }
    },

    async writeFile(relativePath: string, content: Uint8Array): Promise<void> {
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const uri = externalPath
        ? vscode.Uri.file(externalPath)
        : toLogicalUri(await resolveAndValidateLogicalPath(snapshot, relativePath, true));
      const openDocument = findOpenTextDocument(uri);
      const previous = openDocument
        ? Buffer.from(openDocument.getText(), "utf8")
        : await readExistingBytes(uri);
      if (openDocument) {
        const replacement = decodeTextEdit(content, relativePath);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(openDocument.positionAt(0), openDocument.positionAt(openDocument.getText().length)), replacement);
        if (!await vscode.workspace.applyEdit(edit)) {
          throw new Error(`VS Code rejected the edit for open document "${relativePath}". No content was changed.`);
        }
      } else {
        await vscode.workspace.fs.writeFile(uri, content);
      }
      inlinePreview.clear();
      fileChangeRegistry.record(relativePath, previous, content);
    },

    async movePath(source: string, moveOptions: MoveWorkspacePathOptions): Promise<void> {
      const sourceUri = await resolveToolUri(source, true);
      const destinationUri = await resolveToolUri(moveOptions.destination, true);
      if (sourceUri.toString(true) === destinationUri.toString(true)) {
        throw new Error(`Source and destination are the same path: "${source}".`);
      }
      inlinePreview.clear();
      await vscode.workspace.fs.rename(sourceUri, destinationUri, { overwrite: moveOptions.overwrite === true });
    },

    async deletePath(rawPath: string, deleteOptions: DeleteWorkspacePathOptions): Promise<void> {
      const uri = await resolveToolUri(rawPath, true);
      if (deleteOptions.useTrash && uri.scheme !== "file") {
        throw new Error(`Moving to the trash is only supported for local filesystem paths. Pass permanent: true to delete "${rawPath}".`);
      }
      inlinePreview.clear();
      try {
        await vscode.workspace.fs.delete(uri, { recursive: deleteOptions.recursive, useTrash: deleteOptions.useTrash });
      } catch (err: unknown) {
        if (deleteOptions.useTrash && isTrashUnavailable(err)) {
          throw new Error(`The trash is unavailable for "${rawPath}". Pass permanent: true to delete it permanently.`);
        }
        throw err;
      }
    },

    async stat(relativePath: string): Promise<ToolWorkspaceStat> {
      if (relativePath === "." && snapshot.folders.length > 1) {
        return { type: "directory", size: 0 };
      }
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const stat = await vscode.workspace.fs.stat(externalPath ? vscode.Uri.file(externalPath) : toResolvedUri(snapshot, relativePath));
      return { type: toEntryType(stat.type), size: stat.size };
    },

    async createParentDirectory(relativePath: string): Promise<void> {
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      if (externalPath) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(externalPath)));
        return;
      }
      const resolved = resolveLogicalPath(snapshot, relativePath);
      const parentPath = path.posix.dirname(resolved.relativePath);
      if (!parentPath || parentPath === ".") {
        return;
      }
      const parent = { ...resolved, relativePath: parentPath };
      await validateResolvedPath(parent, true);
      await vscode.workspace.fs.createDirectory(toLogicalUri(parent));
    },

    async readDirectory(relativePath: string): Promise<Array<[string, ToolWorkspaceEntryType]>> {
      if (relativePath === "." && snapshot.folders.length > 1) {
        return snapshot.folders.map((folder) => [folder.alias, "directory"]);
      }
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const entries = await vscode.workspace.fs.readDirectory(externalPath ? vscode.Uri.file(externalPath) : toResolvedUri(snapshot, relativePath));
      return entries.map(([name, type]) => [name, toEntryType(type)]);
    },

    async readDocumentSymbols(relativePath: string): Promise<ToolHostDocumentSymbol[]> {
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const uri = externalPath
        ? vscode.Uri.file(externalPath)
        : toLogicalUri(await resolveAndValidateLogicalPath(snapshot, relativePath, options.unrestricted === true));
      const document = findOpenTextDocument(uri) ?? await vscode.workspace.openTextDocument(uri);
      const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
      );
      return (symbols ?? []).map(toHostDocumentSymbol);
    },

    async prepareFileDiff(relativePath: string, before: string, after: string): Promise<void> {
      const externalPath = resolveAllowedExternalPath(snapshot, relativePath, options.allowOutsideWorkspace === true);
      const originalUri = externalPath ? vscode.Uri.file(externalPath) : toResolvedUri(snapshot, relativePath);
      await inlinePreview.show(originalUri, before, after);
    },

    clearFileDiffPreview(): void {
      inlinePreview.clear();
    },
  };
}

function toHostDocumentSymbol(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): ToolHostDocumentSymbol {
  if (symbol instanceof vscode.SymbolInformation) {
    return {
      name: symbol.name,
      kind: symbolKindName(symbol.kind),
      startLine: symbol.location.range.start.line,
      endLine: symbol.location.range.end.line,
      nameLine: symbol.location.range.start.line,
      children: [],
    };
  }
  return {
    name: symbol.name,
    kind: symbolKindName(symbol.kind),
    startLine: symbol.range.start.line,
    endLine: symbol.range.end.line,
    nameLine: symbol.selectionRange.start.line,
    children: symbol.children.map(toHostDocumentSymbol),
  };
}

function symbolKindName(kind: vscode.SymbolKind): string {
  return (vscode.SymbolKind[kind] ?? "symbol").toLowerCase();
}

function isTrashUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /trash|ENOTSUP|not supported/i.test(message);
}

function findOpenTextDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const target = uri.toString(true);
  return vscode.workspace.textDocuments.find((document) => document.uri.toString(true) === target);
}

async function readExistingBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}

function decodeTextEdit(content: Uint8Array, relativePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error(`Cannot apply binary or invalid UTF-8 content to open document "${relativePath}". Close the editor or use a text-safe change.`);
  }
}

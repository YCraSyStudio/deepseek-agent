import * as path from "node:path";
import { realpath } from "node:fs/promises";
import * as vscode from "vscode";
import type { ToolWorkspaceEntryType } from "@/infrastructure/tools/ToolWorkspace";
import { isSensitiveWorkspacePath, resolveWorkspacePathSecure } from "@/infrastructure/tools/ToolWorkspace";
import type { WorkspaceFolderSnapshot, WorkspaceRunSnapshot } from "@/vscode/workspace";

export interface LogicalPath {
  folder: WorkspaceFolderSnapshot;
  relativePath: string;
  logicalPath: string;
}

export async function resolveAndValidateLogicalPath(
  snapshot: WorkspaceRunSnapshot,
  rawPath: string,
  allowSensitive: boolean,
): Promise<LogicalPath> {
  const resolved = resolveLogicalPath(snapshot, rawPath);
  await validateResolvedPath(resolved, allowSensitive);
  return resolved;
}

export function resolveAllowedExternalPath(
  snapshot: WorkspaceRunSnapshot,
  rawPath: string,
  allowOutsideWorkspace: boolean,
): string | undefined {
  if (!allowOutsideWorkspace || typeof rawPath !== "string" || !rawPath.trim() || rawPath.includes("\0")) {
    return undefined;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawPath) && !path.win32.isAbsolute(rawPath)) {
    throw new Error("External paths must be filesystem paths, not URIs");
  }
  if (path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath)) {
    return path.resolve(rawPath);
  }
  if (rawPath.replace(/\\/g, "/").split("/").includes("..")) {
    const defaultLocalRoot = snapshot.folders.find((folder) => folder.alias === snapshot.defaultFolderAlias)?.localPath ??
      (snapshot.folders.length === 1 ? snapshot.folders[0]?.localPath : undefined);
    if (!defaultLocalRoot) {
      throw new Error("Use an absolute filesystem path for access outside a multi-root workspace");
    }
    return path.resolve(defaultLocalRoot, rawPath);
  }
  return undefined;
}

export function resolveLogicalPath(snapshot: WorkspaceRunSnapshot, rawPath: string): LogicalPath {
  if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.includes("\0")) {
    throw new Error("Workspace path is required");
  }
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === ".." || normalized.split("/").includes("..")) {
    throw new Error("Workspace path cannot contain '..' traversal");
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized) || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new Error("Workspace path must be relative to the selected workspace");
  }
  if (snapshot.folders.length === 0) {
    throw new Error("No workspace folder open");
  }
  if (snapshot.folders.length === 1) {
    const folder = snapshot.folders[0]!;
    const withoutOptionalAlias = normalized === folder.alias
      ? "."
      : normalized.startsWith(`${folder.alias}/`) ? normalized.slice(folder.alias.length + 1) : normalized;
    return { folder, relativePath: withoutOptionalAlias || ".", logicalPath: withoutOptionalAlias || "." };
  }
  const [alias, ...segments] = normalized.split("/");
  const folder = snapshot.folders.find((candidate) => candidate.alias === alias);
  if (!folder) {
    throw new Error(`Multi-root workspace paths must start with one of: ${snapshot.folders.map((item) => item.alias).join(", ")}`);
  }
  const relativePath = segments.join("/") || ".";
  return { folder, relativePath, logicalPath: `${folder.alias}${relativePath === "." ? "" : `/${relativePath}`}` };
}

export function isVirtualWorkspaceRoot(snapshot: WorkspaceRunSnapshot, rawPath: string): boolean {
  return snapshot.folders.length > 1 && rawPath.replace(/\\/g, "/").replace(/^\.\//, "") === ".";
}

export function toResolvedUri(snapshot: WorkspaceRunSnapshot, logicalPath: string): vscode.Uri {
  return toLogicalUri(resolveLogicalPath(snapshot, logicalPath));
}

export function toLogicalUri(resolved: LogicalPath): vscode.Uri {
  return resolved.relativePath === "." ? resolved.folder.rootUri : vscode.Uri.joinPath(resolved.folder.rootUri, resolved.relativePath);
}

export async function validateResolvedPath(resolved: LogicalPath, allowSensitive: boolean): Promise<void> {
  if (!allowSensitive && isSensitiveWorkspacePath(resolved.relativePath)) {
    throw new Error("Workspace path points to a sensitive file");
  }
  if (resolved.folder.rootUri.scheme === "file") {
    await resolveWorkspacePathSecure(
      resolved.relativePath,
      resolved.folder.rootUri.fsPath,
      realpath,
      { allowSensitive: true },
    );
    return;
  }
  await rejectVisibleRemoteSymlink(resolved.folder.rootUri, resolved.relativePath);
}

export function formatLogicalPath(snapshot: WorkspaceRunSnapshot, folder: WorkspaceFolderSnapshot, relativePath: string): string {
  return snapshot.folders.length > 1 ? `${folder.alias}/${relativePath}` : relativePath;
}

export function resolveDefaultLocalFolder(snapshot: WorkspaceRunSnapshot): LogicalPath {
  const folder = snapshot.folders.find((candidate) => candidate.alias === snapshot.defaultFolderAlias) ??
    (snapshot.folders.length === 1 ? snapshot.folders[0] : undefined);
  if (!folder) {
    throw new Error(`Terminal cwd is required. Choose one of: ${snapshot.folders.map((item) => item.alias).join(", ")}`);
  }
  return { folder, relativePath: ".", logicalPath: folder.alias };
}

export function resolveSearchPatterns(
  snapshot: WorkspaceRunSnapshot,
  rawPattern: string,
): Array<{ folder: WorkspaceFolderSnapshot; pattern: string }> {
  const pattern = rawPattern.replace(/\\/g, "/").replace(/^\.\//, "") || "**/*";
  if (pattern.split("/").includes("..") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(pattern) || path.posix.isAbsolute(pattern) || path.win32.isAbsolute(pattern)) {
    throw new Error("Search pattern must stay inside the workspace");
  }
  if (snapshot.folders.length > 1) {
    const [candidateAlias, ...rest] = pattern.split("/");
    const folder = snapshot.folders.find((item) => item.alias === candidateAlias);
    if (folder) {
      return [{ folder, pattern: rest.join("/") || "**/*" }];
    }
  }
  return snapshot.folders.map((folder) => ({ folder, pattern }));
}

export async function findFilesInRoot(
  rootUri: vscode.Uri,
  pattern: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<vscode.Uri[]> {
  const cancellation = new vscode.CancellationTokenSource();
  const onAbort = () => cancellation.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const resources = await vscode.workspace.findFiles(new vscode.RelativePattern(rootUri, pattern), undefined, maxResults, cancellation.token);
    if (signal?.aborted) {
      throw createAbortError();
    }
    return resources;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    cancellation.dispose();
  }
}

export function toRelativeWorkspacePath(root: vscode.Uri, resource: vscode.Uri): string {
  if (root.scheme !== resource.scheme || root.authority !== resource.authority) {
    throw new Error("Workspace search returned a resource outside the selected workspace");
  }
  const relativePath = root.scheme === "file"
    ? path.relative(root.fsPath, resource.fsPath)
    : path.posix.relative(root.path, resource.path);
  if (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new Error("Workspace search returned a resource outside the selected workspace");
  }
  return relativePath.replace(/\\/g, "/");
}

export function createAbortError(): Error {
  const error = new Error("Workspace search cancelled");
  error.name = "AbortError";
  return error;
}

export function toEntryType(type: vscode.FileType): ToolWorkspaceEntryType {
  if (type === vscode.FileType.Directory) {
    return "directory";
  }
  if (type === vscode.FileType.File) {
    return "file";
  }
  return "unknown";
}

async function rejectVisibleRemoteSymlink(rootUri: vscode.Uri, relativePath: string): Promise<void> {
  let current = rootUri;
  for (const segment of relativePath.split("/").filter((part) => part && part !== ".")) {
    current = vscode.Uri.joinPath(current, segment);
    try {
      const stat = await vscode.workspace.fs.stat(current);
      if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
        throw new Error("Symbolic links are not allowed for remote workspace operations");
      }
    } catch (error: unknown) {
      if (isMissingWorkspaceResource(error)) {
        return;
      }
      throw error;
    }
  }
}

function isMissingWorkspaceResource(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("FileNotFound") || error.message.includes("Unable to resolve"));
}

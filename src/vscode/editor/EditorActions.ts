import * as vscode from "vscode";
import { logError } from "@/shared/logging/Logger";
import type { PathCompletionItem, WorkspaceBinding } from "@/contracts";
import {
  captureWorkspaceRunSnapshot,
  findSnapshotFolderForUri,
  type WorkspaceFolderSnapshot,
  type WorkspaceRunSnapshot,
} from "@/vscode/workspace";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";

export async function openWorkspaceFile(
  filePath: string,
  binding: WorkspaceBinding,
  line?: number,
): Promise<void> {
  try {
    const snapshot = await validateWorkspaceFilePath(filePath, binding);
    const fileUri = resolveWorkspaceUri(snapshot, filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    if (line !== undefined) {
      const targetLine = Math.max(0, line - 1);
      const position = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  } catch (err) {
    logError(`[EditorActions] Error opening file '${filePath}'`, err);
    await vscode.window.showErrorMessage(err instanceof Error ? err.message : "Unable to open the workspace file.");
  }
}

export async function validateWorkspaceFilePath(
  filePath: string,
  binding: WorkspaceBinding,
): Promise<WorkspaceRunSnapshot> {
  const snapshot = captureWorkspaceRunSnapshot(binding);
  await createVsCodeToolWorkspace(snapshot).resolvePath!(filePath, false);
  return snapshot;
}

export async function insertCodeIntoActiveEditor(code: string, binding: WorkspaceBinding): Promise<void> {
  const snapshot = captureWorkspaceRunSnapshot(binding);
  const editor = vscode.window.activeTextEditor;
  if (!editor || !findSnapshotFolderForUri(snapshot, editor.document.uri)) {
    await vscode.window.showInformationMessage("Open an editor that belongs to this chat workspace before inserting code.");
    return;
  }

  await editor.edit((editBuilder) => {
    for (const selection of editor.selections) {
      editBuilder.replace(selection, code);
    }
  });
}

export async function getPathCompletionItems(
  query: string,
  binding: WorkspaceBinding,
): Promise<PathCompletionItem[]> {
  if (!isSafeCompletionQuery(query)) {
    return [];
  }
  const snapshot = captureWorkspaceRunSnapshot(binding);
  const normalizedQuery = query.replace(/\\/g, "/");
  const remainder = normalizedQuery.slice(2);

  if (snapshot.folders.length > 1 && !remainder.includes("/")) {
    const prefix = remainder.toLocaleLowerCase();
    return snapshot.folders
      .filter((folder) => folder.alias.toLocaleLowerCase().startsWith(prefix))
      .map((folder) => ({ label: `${folder.alias}/`, path: `./${folder.alias}/`, type: "directory" as const }))
      .slice(0, 50);
  }

  const { folder, rootRelativeQuery } = resolveCompletionRoot(snapshot, remainder);
  if (!folder) {
    return [];
  }
  const slashIndex = rootRelativeQuery.lastIndexOf("/");
  const directoryPart = slashIndex >= 0 ? rootRelativeQuery.slice(0, slashIndex + 1) : "";
  const namePrefix = (slashIndex >= 0 ? rootRelativeQuery.slice(slashIndex + 1) : rootRelativeQuery).toLocaleLowerCase();
  const directoryUri = vscode.Uri.joinPath(folder.rootUri, ...directoryPart.split("/").filter(Boolean));
  const outputPrefix = snapshot.folders.length > 1 ? `./${folder.alias}/${directoryPart}` : `./${directoryPart}`;

  try {
    const logicalDirectory = snapshot.folders.length > 1
      ? `${folder.alias}/${directoryPart || "."}`
      : directoryPart || ".";
    await createVsCodeToolWorkspace(snapshot).resolvePath!(logicalDirectory, false);
    const entries = await vscode.workspace.fs.readDirectory(directoryUri);
    return entries
      .filter(([name, type]) =>
        !name.startsWith(".") &&
        name.toLocaleLowerCase().startsWith(namePrefix) &&
        (type & vscode.FileType.SymbolicLink) === 0)
      .map(([name, type]) => {
        const isDirectory = type === vscode.FileType.Directory;
        return {
          label: isDirectory ? `${name}/` : name,
          path: `${outputPrefix}${name}${isDirectory ? "/" : ""}`,
          type: isDirectory ? "directory" : "file",
        } satisfies PathCompletionItem;
      })
      .sort((a, b) => a.type === b.type ? a.label.localeCompare(b.label) : a.type === "directory" ? -1 : 1)
      .slice(0, 50);
  } catch {
    return [];
  }
}

function isSafeCompletionQuery(query: string): boolean {
  const normalized = query.replace(/\\/g, "/");
  return normalized.startsWith("./") &&
    !normalized.split("/").includes("..") &&
    !normalized.includes("\0") &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized.slice(2));
}

function resolveCompletionRoot(
  snapshot: WorkspaceRunSnapshot,
  remainder: string,
): { folder?: WorkspaceFolderSnapshot; rootRelativeQuery: string } {
  if (snapshot.folders.length === 1) {
    return { folder: snapshot.folders[0], rootRelativeQuery: remainder };
  }
  const [alias, ...segments] = remainder.split("/");
  return {
    folder: snapshot.folders.find((candidate) => candidate.alias === alias),
    rootRelativeQuery: segments.join("/"),
  };
}

function resolveWorkspaceUri(snapshot: WorkspaceRunSnapshot, input: string): vscode.Uri {
  const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)
  ) {
    throw new Error("The file path must stay inside the chat workspace.");
  }
  const parts = normalized.split("/").filter(Boolean);
  const folder = snapshot.folders.length === 1
    ? snapshot.folders[0]
    : snapshot.folders.find((candidate) => candidate.alias === parts.shift());
  if (!folder) {
    throw new Error(`Choose a workspace root alias: ${snapshot.folders.map((candidate) => candidate.alias).join(", ")}.`);
  }
  return vscode.Uri.joinPath(folder.rootUri, ...parts);
}

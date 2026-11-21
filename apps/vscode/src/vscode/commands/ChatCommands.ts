import * as cp from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { logError } from "@/shared/logging/Logger";
import { WebviewProvider } from "@/vscode/webviews/WebviewProvider";
import {
  captureCurrentWorkspaceBinding,
  captureWorkspaceRunSnapshot,
  findSnapshotFolderForUri,
  formatWorkspacePath,
} from "@/vscode/workspace";
import { randomUUID } from "node:crypto";
import type { ReferencedFilePayload } from "@/contracts";

const execFile = promisify(cp.execFile);
const MAX_REFERENCE_BYTES = 1024 * 1024;

export function registerChatCommands(context: vscode.ExtensionContext, provider: WebviewProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-agent.addFileToChat", async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      const fallbackUri = vscode.window.activeTextEditor?.document.uri;
      await addFilesToChat(provider, collectCommandUris(uri ?? fallbackUri, selectedUris));
    }),
    vscode.commands.registerCommand("deepseek-agent.addSelectionToChat", async () => {
      await addActiveSelectionToChat(provider);
    }),
    vscode.commands.registerCommand("deepseek-agent.newChat", async () => {
      await provider.startNewChat();
    }),
    vscode.commands.registerCommand("deepseek-agent.reviewChanges", async () => {
      await reviewWorkspaceChanges(provider);
    }),
  );
}

async function addFilesToChat(provider: WebviewProvider, uris: vscode.Uri[]): Promise<void> {
  const references: ReferencedFilePayload[] = [];

  for (const uri of uris.slice(0, 50)) {
    const reference = await createReferenceFromUri(uri);
    if (reference) {
      references.push(reference);
    }
  }

  if (references.length === 0) {
    vscode.window.showInformationMessage("Select a file to add to YCraSy DeepSeek Agent chat.");
    return;
  }

  await provider.addReferencedFiles(references);
}

async function addActiveSelectionToChat(provider: WebviewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showInformationMessage("Select code in an editor to add it to YCraSy DeepSeek Agent chat.");
    return;
  }

  const text = editor.document.getText(editor.selection);
  if (!text.trim()) {
    vscode.window.showInformationMessage("Select code in an editor to add it to YCraSy DeepSeek Agent chat.");
    return;
  }
  if (Buffer.byteLength(text, "utf8") > MAX_REFERENCE_BYTES) {
    await vscode.window.showWarningMessage("The selected context exceeds the 1 MiB limit.");
    return;
  }
  let metadata = getReferenceMetadata(editor.document.uri);
  if (metadata.scope === "external-snapshot" && isSensitiveUri(editor.document.uri)) {
    const choice = await vscode.window.showWarningMessage(
      `Add a selection from potentially sensitive file "${getName(editor.document.uri)}" as a read-only context snapshot?`,
      { modal: true },
      "Add snapshot",
    );
    if (choice !== "Add snapshot") {
      return;
    }
    metadata = { scope: "external-snapshot" };
  }

  const path = getDisplayPath(editor.document.uri);
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;

  await provider.addReferencedFiles([
    {
      path,
      name: `${getName(editor.document.uri)}:${startLine}${endLine === startLine ? "" : `-${endLine}`}`,
      content: text,
      language: editor.document.languageId,
      type: "file",
      size: Buffer.byteLength(text, "utf8"),
      selection: {
        startLine,
        startCharacter: editor.selection.start.character + 1,
        endLine,
        endCharacter: editor.selection.end.character + 1,
      },
      ...metadata,
    },
  ]);
}

async function reviewWorkspaceChanges(provider: WebviewProvider): Promise<void> {
  const snapshot = captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding());
  const localFolders = snapshot.folders.filter((folder) => folder.localPath);
  if (localFolders.length === 0) {
    vscode.window.showInformationMessage("Open a workspace to review changes with YCraSy DeepSeek Agent.");
    return;
  }

  try {
    const sections = await Promise.all(localFolders.map(async (folder) => {
      const [unstaged, staged] = await Promise.all([
        runGit(["diff", "--", "."], folder.localPath!),
        runGit(["diff", "--cached", "--", "."], folder.localPath!),
      ]);
      const diff = [formatDiffSection("Staged changes", staged), formatDiffSection("Unstaged changes", unstaged)].filter(Boolean).join("\n\n");
      return diff ? `# Workspace root: ${folder.alias}\n\n${diff}` : "";
    }));
    const content = sections.filter(Boolean).join("\n\n");

    if (!content.trim()) {
      vscode.window.showInformationMessage("No Git changes found to review.");
      return;
    }

    await provider.setDraft("Review these workspace changes.");
    await provider.addReferencedFiles([
      {
        referenceId: randomUUID(),
        path: "git.diff",
        name: "git.diff",
        content: truncateContent(content),
        language: "diff",
        type: "file",
        size: Buffer.byteLength(content, "utf8"),
        scope: "external-snapshot",
      },
    ]);
  } catch (err) {
    logError("[ChatCommands] Error collecting Git changes", err);
    vscode.window.showErrorMessage("YCraSy DeepSeek Agent could not collect Git changes for review.");
  }
}

function collectCommandUris(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): vscode.Uri[] {
  const uris = selectedUris?.length ? selectedUris : uri ? [uri] : [];
  return [...new Map(uris.map((item) => [item.toString(), item])).values()];
}

async function createReferenceFromUri(uri: vscode.Uri): Promise<ReferencedFilePayload | null> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) {
      return null;
    }

    const name = getName(uri);
    let metadata = getReferenceMetadata(uri);
    if (metadata.scope === "external-snapshot" && stat.size > MAX_REFERENCE_BYTES) {
      await vscode.window.showWarningMessage(`"${name}" exceeds the 1 MiB limit for external context snapshots.`);
      return null;
    }
    if (isSensitiveUri(uri)) {
      const choice = await vscode.window.showWarningMessage(
        `Add potentially sensitive file "${name}" as a read-only context snapshot?`,
        { modal: true },
        "Add snapshot",
      );
      if (choice !== "Add snapshot") {
        return null;
      }
      metadata = { scope: "external-snapshot" };
    }
    const bytes = stat.size <= MAX_REFERENCE_BYTES ? await vscode.workspace.fs.readFile(uri) : undefined;
    if (bytes && looksBinary(bytes)) {
      await vscode.window.showWarningMessage(`"${name}" appears to be binary and was not added.`);
      return null;
    }
    return {
      referenceId: randomUUID(),
      path: metadata.scope === "external-snapshot" ? name : getDisplayPath(uri),
      name,
      content: bytes ? Buffer.from(bytes).toString("utf8") : undefined,
      language: getExtension(uri),
      type: "file",
      size: stat.size,
      ...metadata,
    };
  } catch (err) {
    logError(`[ChatCommands] Error creating reference for '${uri.toString()}'`, err);
    return null;
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, maxBuffer: MAX_REFERENCE_BYTES * 2, timeout: 5_000, encoding: "utf8" });
  return stdout;
}

function formatDiffSection(title: string, diff: string): string {
  return diff.trim() ? `# ${title}\n${diff.trim()}` : "";
}

function truncateContent(content: string): string {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength <= MAX_REFERENCE_BYTES) {
    return content;
  }

  return `${buffer.subarray(0, MAX_REFERENCE_BYTES).toString("utf8")}\n\n[Diff truncated at 1 MB]`;
}

function getDisplayPath(uri: vscode.Uri): string {
  const binding = captureCurrentWorkspaceBinding();
  if (binding.folders.length === 0) {
    return getName(uri);
  }
  const snapshot = captureWorkspaceRunSnapshot(binding);
  return formatWorkspacePath(snapshot, uri) ?? getName(uri);
}

function getReferenceMetadata(uri: vscode.Uri): Pick<ReferencedFilePayload, "scope" | "rootUri" | "bindingRevision"> {
  const binding = captureCurrentWorkspaceBinding();
  if (binding.folders.length === 0) {
    return { scope: "external-snapshot" };
  }
  const snapshot = captureWorkspaceRunSnapshot(binding);
  const folder = findSnapshotFolderForUri(snapshot, uri);
  return folder
    ? { scope: "workspace", rootUri: folder.uri, bindingRevision: snapshot.binding.revision }
    : { scope: "external-snapshot" };
}

function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8_192).some((value) => value === 0);
}

function isSensitiveUri(uri: vscode.Uri): boolean {
  return /(^|[/\\.])(env(?:\.[^/\\]+)?|pem|key|p12|pfx|\.ssh|credentials?|secrets?|tokens?)([/\\.]|$)/i.test(uri.path);
}

function getName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() || uri.fsPath.split(/[/\\]/).pop() || "unknown";
}

function getExtension(uri: vscode.Uri): string {
  const name = getName(uri);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex + 1) : "";
}

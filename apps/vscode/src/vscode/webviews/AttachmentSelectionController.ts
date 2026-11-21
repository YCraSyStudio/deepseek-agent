import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { ReferencedFile, ReferencedFilePayload } from "@/contracts";
import { isUriInsideRoot } from "@/vscode/workspace";
import { getErrorMessage } from "@/shared/utils/Errors";
import type { ChatHandler } from "./handlers/chat/ChatHandler";
import type { ImageAttachmentController } from "./ImageAttachmentController";

interface AttachmentSelectionControllerDependencies {
  chatHandler: ChatHandler;
  imageAttachments: ImageAttachmentController;
}

export class AttachmentSelectionController {
  constructor(private readonly dependencies: AttachmentSelectionControllerDependencies) {}

  async select(
    requestId: string,
    conversationId: string | undefined,
    webviewView: vscode.WebviewView,
  ): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      title: "Attach files",
      openLabel: "Attach to chat",
    });
    if (!selected?.length) {
      return;
    }
    try {
      const { attachments, contextUris } = await this.dependencies.imageAttachments.classifyAndUpload(
        webviewView.webview,
        selected,
      );
      await webviewView.webview.postMessage({
        type: "imageAttachmentsSelected",
        requestId,
        attachments,
      });
      await this.postContextFiles(contextUris, conversationId, webviewView);
    } catch (error: unknown) {
      await webviewView.webview.postMessage({
        type: "imageAttachmentsSelected",
        requestId,
        attachments: [],
        error: getErrorMessage(error),
      });
    }
  }

  private async postContextFiles(
    selected: readonly vscode.Uri[],
    conversationId: string | undefined,
    webviewView: vscode.WebviewView,
  ): Promise<void> {
    if (selected.length === 0) {
      return;
    }
    const context = await this.dependencies.chatHandler.getWorkspaceContext(conversationId);
    const files: ReferencedFilePayload[] = [];
    for (const uri of selected.slice(0, 10)) {
      const file = await createContextFile(uri, context.binding).catch(() => undefined);
      if (file) {
        files.push(file);
      }
    }
    this.dependencies.chatHandler.registerExternalContextFiles(files as ReferencedFile[]);
    await webviewView.webview.postMessage({ type: "contextFilesSelected", files });
  }
}

async function createContextFile(
  uri: vscode.Uri,
  binding: Awaited<ReturnType<ChatHandler["getWorkspaceContext"]>>["binding"],
): Promise<ReferencedFilePayload | undefined> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type !== vscode.FileType.File || stat.size > 1024 * 1024) {
    return undefined;
  }
  const contentBytes = await vscode.workspace.fs.readFile(uri);
  if (looksBinary(contentBytes)) {
    return undefined;
  }
  const internalFolder = binding.folders.find(
    (folder) => isUriInsideRoot(uri, vscode.Uri.parse(folder.uri)),
  );
  const name = uri.path.split("/").pop() || "context-file";
  const sensitive = isSensitiveUri(uri);
  if (sensitive) {
    const choice = await vscode.window.showWarningMessage(
      `Add potentially sensitive file "${name}" as a read-only context snapshot?`,
      { modal: true },
      "Add snapshot",
    );
    if (choice !== "Add snapshot") {
      return undefined;
    }
  }
  const snapshotOnly = !internalFolder || sensitive;
  const relative = internalFolder
    ? relativeUriPath(vscode.Uri.parse(internalFolder.uri), uri)
    : undefined;
  return {
    referenceId: randomUUID(),
    path: snapshotOnly
      ? name
      : `./${binding.folders.length > 1 ? `${internalFolder!.alias}/` : ""}${relative}`,
    name,
    content: Buffer.from(contentBytes).toString("utf8"),
    language: name.includes(".") ? name.split(".").pop() : undefined,
    type: "file",
    size: stat.size,
    scope: snapshotOnly ? "external-snapshot" : "workspace",
    rootUri: snapshotOnly ? undefined : internalFolder!.uri,
    bindingRevision: snapshotOnly ? undefined : binding.revision,
  };
}

function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8_192).some((value) => value === 0);
}

function isSensitiveUri(uri: vscode.Uri): boolean {
  return /(^|[/\\.])(env(?:\.[^/\\]+)?|pem|key|p12|pfx|\.ssh|credentials?|secrets?|tokens?)([/\\.]|$)/i.test(uri.path);
}

function relativeUriPath(root: vscode.Uri, candidate: vscode.Uri): string | undefined {
  const relative = root.scheme === "file"
    ? path.relative(root.fsPath, candidate.fsPath)
    : path.posix.relative(root.path, candidate.path);
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    relative.startsWith("..\\") ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.replace(/\\/g, "/");
}


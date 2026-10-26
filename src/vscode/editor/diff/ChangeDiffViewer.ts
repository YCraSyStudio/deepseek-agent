import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { WorkspaceBinding } from "@/contracts";
import { logError } from "@/shared/logging/Logger";
import { validateWorkspaceFilePath } from "../EditorActions";
import { MAX_RECORDED_DIFF_LINES } from "@/infrastructure/tools/builtins/fileSystem/StructuredResult";
import { fileChangeRegistry } from "./FileChangeRegistry";
import { reconstructDiffDocuments, type DiffDocuments } from "./UnifiedDiffDocuments";

const CHANGE_SCHEME = "ycrasy-change";
const MAX_RETAINED_DOCUMENTS = 24;

interface ChangeDiffRequest {
  path: string;
  diff?: string;
  beforeHash?: string;
  afterHash?: string;
  preview?: boolean;
  conversationId?: string;
  generationId?: string;
}

interface ReviewScope { conversationId: string; generationId: string }

export class ChangeDiffViewer implements vscode.Disposable {
  private readonly documents = new Map<string, string>();
  private readonly scopes = new Map<string, ReviewScope>();
  private readonly disposables: vscode.Disposable[];

  constructor(revert?: (scope: ReviewScope) => Promise<void>) {
    const provider: vscode.TextDocumentContentProvider = {
      provideTextDocumentContent: (uri) => this.documents.get(uri.toString()) ?? "",
    };
    this.disposables = [
      vscode.workspace.registerTextDocumentContentProvider(CHANGE_SCHEME, provider),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === CHANGE_SCHEME) {
          this.documents.delete(document.uri.toString());
          this.scopes.delete(document.uri.toString());
        }
      }),
    ];
    if (revert) {
      this.disposables.push(vscode.commands.registerCommand("deepseek-agent.revertReviewedTurn", async () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        const uri = input instanceof vscode.TabInputTextDiff ? input.modified : vscode.window.activeTextEditor?.document.uri;
        const scope = uri ? this.scopes.get(uri.toString()) : undefined;
        if (!scope) {await vscode.window.showErrorMessage("This review has no recoverable turn snapshot"); return;}
        try {await revert(scope);}
        catch (error) {await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));}
      }));
    }
  }

  public async open(request: ChangeDiffRequest, binding: WorkspaceBinding): Promise<void> {
    try {
      await validateWorkspaceFilePath(request.path, binding);
      const documents = resolveDiffDocuments(request);
      if (!documents) {
        throw new Error("The saved change is incomplete and cannot be compared.");
      }

      await this.openSaved(request.path, documents, request.conversationId && request.generationId
        ? { conversationId: request.conversationId, generationId: request.generationId } : undefined, request.preview);
    } catch (err) {
      logError(`[ChangeDiffViewer] Error opening change for '${request.path}'`, err);
      await vscode.window.showErrorMessage(err instanceof Error ? err.message : "Unable to open the saved change.");
    }
  }

  public async openSaved(filePath: string, documents: DiffDocuments, scope?: ReviewScope, preview = true): Promise<void> {
    const id = randomUUID();
    const filename = sanitizeFilename(path.posix.basename(filePath.replace(/\\/g, "/")));
    const beforeUri = vscode.Uri.from({ scheme: CHANGE_SCHEME, path: `/${id}/before/${filename}` });
    const afterUri = vscode.Uri.from({ scheme: CHANGE_SCHEME, path: `/${id}/after/${filename}` });
    this.retain(beforeUri, documents.before);
    this.retain(afterUri, documents.after);
    if (scope) {this.scopes.set(beforeUri.toString(), scope); this.scopes.set(afterUri.toString(), scope);}

    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      `${filename} — DeepSeek change`,
      { preview },
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.documents.clear();
    this.scopes.clear();
  }

  private retain(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    while (this.documents.size > MAX_RETAINED_DOCUMENTS) {
      const oldest = this.documents.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.documents.delete(oldest);
      this.scopes.delete(oldest);
    }
  }
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename.replace(/[/?#\u0000-\u001f]/g, "_");
  return sanitized || "change.txt";
}

function resolveDiffDocuments(request: ChangeDiffRequest): DiffDocuments | null {
  if (request.afterHash) {
    const recorded = fileChangeRegistry.find(request.path, request.beforeHash, request.afterHash);
    if (recorded) {
      return { before: recorded.before, after: recorded.after };
    }
  }
  if (!request.diff || countLines(request.diff) > MAX_RECORDED_DIFF_LINES) {
    return null;
  }
  return reconstructDiffDocuments(request.diff);
}

function countLines(value: string): number {
  let lines = 1;
  for (const character of value) {
    if (character === "\n") {
      lines += 1;
    }
  }
  return lines;
}

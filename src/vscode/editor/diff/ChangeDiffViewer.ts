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
}

export class ChangeDiffViewer implements vscode.Disposable {
  private readonly documents = new Map<string, string>();
  private readonly disposables: vscode.Disposable[];

  constructor() {
    const provider: vscode.TextDocumentContentProvider = {
      provideTextDocumentContent: (uri) => this.documents.get(uri.toString()) ?? "",
    };
    this.disposables = [
      vscode.workspace.registerTextDocumentContentProvider(CHANGE_SCHEME, provider),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === CHANGE_SCHEME) {
          this.documents.delete(document.uri.toString());
        }
      }),
    ];
  }

  public async open(request: ChangeDiffRequest, binding: WorkspaceBinding): Promise<void> {
    try {
      await validateWorkspaceFilePath(request.path, binding);
      const documents = resolveDiffDocuments(request);
      if (!documents) {
        throw new Error("The saved change is incomplete and cannot be compared.");
      }

      const id = randomUUID();
      const filename = sanitizeFilename(path.posix.basename(request.path.replace(/\\/g, "/")));
      const beforeUri = vscode.Uri.from({ scheme: CHANGE_SCHEME, path: `/${id}/before/${filename}` });
      const afterUri = vscode.Uri.from({ scheme: CHANGE_SCHEME, path: `/${id}/after/${filename}` });
      this.retain(beforeUri, documents.before);
      this.retain(afterUri, documents.after);

      await vscode.commands.executeCommand(
        "vscode.diff",
        beforeUri,
        afterUri,
        `${filename} — DeepSeek change`,
        { preview: request.preview ?? true },
      );
    } catch (err) {
      logError(`[ChangeDiffViewer] Error opening change for '${request.path}'`, err);
      await vscode.window.showErrorMessage(err instanceof Error ? err.message : "Unable to open the saved change.");
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.documents.clear();
  }

  private retain(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    while (this.documents.size > MAX_RETAINED_DOCUMENTS) {
      const oldest = this.documents.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.documents.delete(oldest);
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

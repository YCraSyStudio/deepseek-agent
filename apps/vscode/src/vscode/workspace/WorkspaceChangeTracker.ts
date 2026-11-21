import * as vscode from "vscode";
import {
  captureWorkspaceSnapshot,
  workspaceChangeNotice,
  type SnapshotRoot,
  type WorkspaceSnapshot,
} from "@/infrastructure/workspace/WorkspaceSnapshot";
import { WorkspaceRestoreStore } from "@/infrastructure/workspace/WorkspaceRestoreStore";
import { logWarning } from "@/shared/logging/Logger";
import type { WorkspaceRunSnapshot } from "./WorkspaceContext";

export interface WorkspaceChangeTracking {
  notice: string;
  finish(): Promise<void>;
}

export class WorkspaceChangeTracker {
  private readonly memory = new Map<string, WorkspaceSnapshot>();

  async begin(conversationId: string, generationId: string, incognito: boolean, workspace: WorkspaceRunSnapshot, signal?: AbortSignal, limitMb = 1024): Promise<WorkspaceChangeTracking> {
    const store = incognito ? undefined : new WorkspaceRestoreStore(conversationId, undefined, limitMb);
    let captured = false;
    const capture = async (cancellation?: AbortSignal): Promise<WorkspaceSnapshot> => {
      if (workspace.folders.some((folder) => !folder.localPath)) {
        throw new Error("Workspace snapshots require local filesystem access");
      }
      return captureWorkspaceSnapshot(snapshotRoots(workspace), dirtyContents(), cancellation);
    };
    const save = async (snapshot: WorkspaceSnapshot): Promise<void> => {
      this.memory.delete(conversationId);
      this.memory.set(conversationId, snapshot);
      if (this.memory.size > 100) {this.memory.delete(this.memory.keys().next().value!);}
    };
    let notice = "";
    try {
      const { previous, current } = store
        ? await store.begin(generationId, snapshotRoots(workspace), dirtyContents(), signal)
        : { previous: this.memory.get(conversationId), current: await capture(signal) };
      captured = true;
      notice = workspaceChangeNotice(previous, current);
      if (!store) {await save(current);}
    } catch (error) {
      logWarning("Could not capture the workspace before the turn", error, { conversationId });
      if (store) {void vscode.window.showWarningMessage(`This message will continue without a recovery copy. Revert will be unavailable for this turn: ${error instanceof Error ? error.message : String(error)}`);}
      notice = "Workspace changes could not be checked. Previous file contents may be stale; read relevant files before editing them.";
    }
    return {
      notice,
      finish: async () => {
        try {
          if (store) {if (captured) {await store.finish(generationId, snapshotRoots(workspace), dirtyContents());}}
          else {await save(await capture());}
        }
        catch (error) {
          logWarning("Could not update the workspace snapshot after the turn", error, { conversationId });
          if (store) {void vscode.window.showWarningMessage(`The recovery copy could not be completed. Revert is unavailable for this turn: ${error instanceof Error ? error.message : String(error)}`);}
        }
      },
    };
  }
}

export function snapshotRoots(workspace: WorkspaceRunSnapshot): SnapshotRoot[] {
  if (workspace.folders.some((folder) => !folder.localPath)) {throw new Error("Workspace snapshots require local filesystem access");}
  return workspace.folders.map((folder) => ({ uri: folder.uri, alias: folder.alias, localPath: folder.localPath! }));
}

function dirtyContents(): Map<string, string> {
  return new Map(vscode.workspace.textDocuments.filter((document) => document.isDirty && document.uri.scheme === "file")
    .map((document) => [document.uri.fsPath, document.getText()]));
}

export async function revertWorkspaceTurn(conversationId: string, workspace: WorkspaceRunSnapshot, generationId?: string, assertIdle: () => void = () => undefined): Promise<string> {
  const result = await new WorkspaceRestoreStore(conversationId).revert(snapshotRoots(workspace), generationId, (paths) => {
    assertIdle();
    if (!vscode.workspace.isTrusted) {throw new Error("Trust the workspace before reverting changes");}
    const dirty = vscode.workspace.textDocuments.find((document) => document.isDirty && paths.includes(document.uri.fsPath));
    if (dirty) {throw new Error(`Save or discard unsaved edits to ${dirty.uri.fsPath} before reverting this turn`);}
  });
  return `Reverted turn ${result.generationId}: restored ${result.paths.length} changed paths to their state before the user message. Read affected files again before editing them.`;
}

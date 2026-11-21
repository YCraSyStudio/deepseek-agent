import type { ReferencedFile, WorkspaceBinding } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { HistoryManager } from "@/vscode/storage";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";
import {
  captureCurrentWorkspaceBinding,
  captureWorkspaceRunSnapshot,
  resolveWorkspaceContext,
} from "@/vscode/workspace";

interface ConversationWorkspaceReferencesDependencies {
  conversationState: ConversationState;
  historyManager: HistoryManager;
  post: (message: Record<string, unknown>) => void;
}

export class ConversationWorkspaceReferences {
  private readonly externalSnapshots = new Map<string, ReferencedFile>();

  constructor(
    private readonly dependencies: ConversationWorkspaceReferencesDependencies,
  ) {}

  registerExternalContextFiles(files: ReferencedFile[]): void {
    for (const file of files) {
      if (
        file.scope === "external-snapshot" &&
        file.referenceId &&
        file.content !== undefined
      ) {
        this.externalSnapshots.set(file.referenceId, structuredClone(file));
      }
    }
    while (this.externalSnapshots.size > 50) {
      this.externalSnapshots.delete(this.externalSnapshots.keys().next().value!);
    }
  }

  clear(): void {
    this.externalSnapshots.clear();
  }

  async getBinding(conversationId?: string): Promise<WorkspaceBinding> {
    if (conversationId) {
      const selected = this.dependencies.conversationState.getConversation();
      if (selected?.id === conversationId) {
        return selected.workspaceBinding;
      }
      const stored = await this.dependencies.historyManager.getById(conversationId);
      if (stored) {
        return stored.workspaceBinding;
      }
    }
    return captureCurrentWorkspaceBinding();
  }

  async validateFiles(
    files: ReferencedFile[] | undefined,
    binding: WorkspaceBinding,
  ): Promise<ReferencedFile[] | undefined> {
    if (!files?.length) {
      return undefined;
    }
    const snapshot = captureWorkspaceRunSnapshot(binding);
    const workspace = createVsCodeToolWorkspace(snapshot);
    const accepted: ReferencedFile[] = [];
    for (const file of files) {
      if (file.scope === "external-snapshot") {
        const registered = file.referenceId
          ? this.externalSnapshots.get(file.referenceId)
          : undefined;
        if (!registered) {
          throw new Error(`External context file "${file.path}" must be selected again.`);
        }
        accepted.push(structuredClone(registered));
        this.externalSnapshots.delete(file.referenceId!);
        continue;
      }
      if (file.bindingRevision && file.bindingRevision !== binding.revision) {
        throw new Error(`Workspace reference "${file.path}" is stale.`);
      }
      const logicalPath = await workspace.resolvePath!(file.path, false);
      accepted.push({
        ...file,
        path: logicalPath.startsWith("./") ? logicalPath : `./${logicalPath}`,
        scope: "workspace",
        bindingRevision: binding.revision,
      });
    }
    return accepted;
  }

  postContext(binding: WorkspaceBinding): void {
    this.dependencies.post({
      type: "workspaceContextChanged",
      context: resolveWorkspaceContext(binding),
    });
  }
}

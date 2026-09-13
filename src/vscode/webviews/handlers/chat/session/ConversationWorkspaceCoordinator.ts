import * as vscode from "vscode";
import type { QueuedGenerationMessage, WorkspaceContextStatus } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import type { GenerationCheckpointStore, HistoryManager } from "@/vscode/storage";
import {
  captureCurrentWorkspaceBinding,
  resolveWorkspaceContext,
} from "@/vscode/workspace";
import { getErrorMessage } from "../ChatErrors";
import type { ConversationWorkspaceReferences } from "./ConversationWorkspaceReferences";
import type { GenerationRunRecord } from "../generation/GenerationRun";
import type { SendMessagePayload } from "../Types";

interface ConversationWorkspaceCoordinatorDependencies {
  checkpointStore: GenerationCheckpointStore;
  conversationState: ConversationState;
  coordinator: GenerationCoordinator<SendMessagePayload>;
  historyManager: HistoryManager;
  post: (message: Record<string, unknown>) => void;
  postGenerationSnapshot: () => void;
  recoveredDrafts: Map<string, QueuedGenerationMessage[]>;
  runs: Map<string, GenerationRunRecord>;
  workspaceReferences: ConversationWorkspaceReferences;
}

export class ConversationWorkspaceCoordinator {
  constructor(private readonly dependencies: ConversationWorkspaceCoordinatorDependencies) {}

  async getContext(conversationId?: string): Promise<WorkspaceContextStatus> {
    const binding = await this.dependencies.workspaceReferences.getBinding(conversationId);
    return resolveWorkspaceContext(binding);
  }

  async rebind(conversationId: string): Promise<WorkspaceContextStatus> {
    const current = captureCurrentWorkspaceBinding();
    if (current.folders.length === 0) {
      throw new Error("Open at least one workspace folder before reassigning this conversation.");
    }
    const conversation = await this.dependencies.historyManager.getById(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }

    this.recoverQueuedDrafts(conversationId);
    await this.interruptActiveGeneration(conversationId);

    const rebound: StoredConversation = {
      ...conversation,
      workspaceUri: current.uri,
      workspaceBinding: current,
      workspaceRebindings: [
        ...(conversation.workspaceRebindings ?? []),
        {
          fromWorkspaceUri: conversation.workspaceBinding.uri,
          toWorkspaceUri: current.uri,
          at: Date.now(),
        },
      ].slice(-100),
      updatedAt: Date.now(),
    };
    await this.dependencies.checkpointStore.delete(conversationId);
    await this.dependencies.historyManager.save(rebound);
    if (this.dependencies.conversationState.getActiveConversationId() === conversationId) {
      this.dependencies.conversationState.load(rebound);
    }
    this.dependencies.workspaceReferences.postContext(current);
    return resolveWorkspaceContext(current);
  }

  async confirmAndRebind(conversationId: string, expectedRevision?: string): Promise<void> {
    const currentContext = await this.getContext(conversationId);
    if (expectedRevision && expectedRevision !== currentContext.binding.revision) {
      this.dependencies.post({
        type: "workspaceRebindResult",
        success: false,
        error: "The stored workspace binding changed. Refresh and try again.",
      });
      return;
    }
    try {
      const context = await this.rebind(conversationId);
      this.dependencies.post({ type: "workspaceRebindResult", success: true, context });
      this.dependencies.postGenerationSnapshot();
    } catch (error: unknown) {
      this.dependencies.post({
        type: "workspaceRebindResult",
        success: false,
        error: getErrorMessage(error),
      });
    }
  }

  async open(conversationId: string): Promise<void> {
    const binding = await this.dependencies.workspaceReferences.getBinding(conversationId);
    if (binding.uri.startsWith("ycrasy-workspace:")) {
      await vscode.window.showInformationMessage(
        `Open the workspace "${binding.name}" manually; it was not saved as a .code-workspace file.`,
      );
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.parse(binding.uri),
      { forceNewWindow: true },
    );
  }

  async handleFoldersChanged(selectedConversationId?: string): Promise<void> {
    const affected = new Set<string>();
    const conversationIds = new Set([
      ...this.dependencies.coordinator.getActiveGenerations()
        .map((active) => active.task.conversationId),
      ...this.dependencies.coordinator.getQueuedConversationIds(),
    ]);
    for (const conversationId of conversationIds) {
      const selected = this.dependencies.conversationState.getConversation();
      const conversation = await this.dependencies.historyManager.getById(conversationId) ??
        (selected?.id === conversationId ? selected : undefined);
      const binding = conversation?.workspaceBinding;
      if (binding && resolveWorkspaceContext(binding).state !== "connected") {
        affected.add(conversationId);
        const active = this.dependencies.coordinator.getActiveForConversation(conversationId);
        if (active) {
          this.dependencies.runs.get(active.generationId)?.session.cancel();
          this.dependencies.coordinator.interrupt(active.generationId, "workspace_changed");
        }
      }
    }
    for (const conversationId of affected) {
      this.recoverQueuedDrafts(conversationId);
    }
    this.dependencies.workspaceReferences.postContext(
      await this.dependencies.workspaceReferences.getBinding(selectedConversationId),
    );
    this.dependencies.postGenerationSnapshot();
  }

  private recoverQueuedDrafts(conversationId: string): void {
    const queued = this.dependencies.coordinator.clearQueue(conversationId);
    if (queued.length === 0) {
      return;
    }
    this.dependencies.recoveredDrafts.set(conversationId, queued.map((task) => ({
      clientRequestId: task.clientRequestId,
      text: task.payload.text,
      queuedAt: task.queuedAt,
    })));
  }

  private async interruptActiveGeneration(conversationId: string): Promise<void> {
    const active = this.dependencies.coordinator.getActiveForConversation(conversationId);
    if (!active) {
      return;
    }
    this.dependencies.runs.get(active.generationId)?.session.cancel();
    this.dependencies.coordinator.interrupt(active.generationId, "workspace_changed");
    await active.completion;
  }
}

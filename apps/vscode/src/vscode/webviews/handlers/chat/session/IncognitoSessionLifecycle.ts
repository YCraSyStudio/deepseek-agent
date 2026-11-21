import type { QueuedGenerationMessage, WorkspaceBinding } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SettingsRepository } from "@/application/ports";
import type { GenerationCheckpointStore } from "@/vscode/storage";
import type { ChatActivityBroadcaster } from "../activity/ChatActivityBroadcaster";
import type { ConversationWorkspaceReferences } from "./ConversationWorkspaceReferences";
import { transitionGenerationRun, type GenerationRunRecord } from "../generation/GenerationRun";
import type { HistoryTransitionState, SendMessagePayload } from "../Types";

interface IncognitoSessionLifecycleDependencies {
  broadcaster: ChatActivityBroadcaster;
  captureBinding: () => WorkspaceBinding;
  checkpointStore: GenerationCheckpointStore;
  clearSelectedConversation: () => void;
  conversationState: ConversationState;
  coordinator: GenerationCoordinator<SendMessagePayload>;
  recoveredDrafts: Map<string, QueuedGenerationMessage[]>;
  runs: ReadonlyMap<string, GenerationRunRecord>;
  settings: SettingsRepository;
  workspaceReferences: ConversationWorkspaceReferences;
}

export class IncognitoSessionLifecycle {
  private historyTransition?: HistoryTransitionState;

  constructor(
    private readonly dependencies: IncognitoSessionLifecycleDependencies,
  ) {}

  getHistoryTransition(): HistoryTransitionState | undefined {
    return this.historyTransition;
  }

  isTransitionActive(): boolean {
    return this.historyTransition !== undefined;
  }

  beginHistoryTransition(
    requestId: string,
    direction: "enter-incognito" | "exit-incognito",
  ): { activeGenerations: number; queuedMessages: number } | undefined {
    if (this.historyTransition && this.historyTransition.requestId !== requestId) {
      return undefined;
    }
    this.historyTransition = {
      requestId,
      direction,
      phase: "stop-work",
    };
    return this.getPendingWorkCounts();
  }

  setHistoryTransitionPhase(phase: "stop-work" | "exit-incognito"): void {
    if (this.historyTransition) {
      this.historyTransition.phase = phase;
    }
  }

  cancelHistoryTransition(requestId: string): void {
    if (this.historyTransition?.requestId === requestId) {
      this.historyTransition = undefined;
    }
  }

  getPendingWorkCounts(): { activeGenerations: number; queuedMessages: number } {
    return this.dependencies.broadcaster.pendingWorkCounts();
  }

  hasIncognitoMessages(): boolean {
    const { conversationState } = this.dependencies;
    return conversationState.isIncognito() && conversationState.hasMessages();
  }

  async stopPendingWork(): Promise<void> {
    const { coordinator, recoveredDrafts, runs } = this.dependencies;
    for (const conversationId of coordinator.getQueuedConversationIds()) {
      coordinator.clearQueue(conversationId);
    }
    const active = [...coordinator.getActiveGenerations()];
    for (const generation of active) {
      const record = runs.get(generation.generationId);
      if (record) {
        transitionGenerationRun(record, "interrupted");
        record.session.cancel();
      }
      coordinator.interrupt(generation.generationId, "history_transition");
    }
    await Promise.allSettled(active.map((generation) => generation.completion));
    recoveredDrafts.clear();
  }

  async enterIncognito(requestId: string): Promise<void> {
    await this.stopPendingWork();
    await this.dependencies.checkpointStore.clearAll().catch(() => undefined);
    this.dependencies.workspaceReferences.clear();
    this.dependencies.conversationState.reset("incognito");
    this.dependencies.clearSelectedConversation();
    this.dependencies.broadcaster.post({ type: "clearChat" });
    this.dependencies.workspaceReferences.postContext(this.dependencies.captureBinding());
    this.dependencies.broadcaster.postGenerationSnapshot();
    this.cancelHistoryTransition(requestId);
  }

  async promoteIncognito(requestId: string): Promise<void> {
    await this.dependencies.conversationState.promoteIncognito();
    this.cancelHistoryTransition(requestId);
  }

  discardIncognito(requestId: string): void {
    this.dependencies.conversationState.reset("persistent");
    this.dependencies.clearSelectedConversation();
    this.dependencies.workspaceReferences.clear();
    this.dependencies.broadcaster.post({ type: "clearChat" });
    this.dependencies.workspaceReferences.postContext(this.dependencies.captureBinding());
    this.dependencies.broadcaster.postGenerationSnapshot();
    this.cancelHistoryTransition(requestId);
  }

  async discardIncognitoForWebviewRecreation(): Promise<void> {
    if (this.dependencies.settings.load().historyEnabled) {
      return;
    }
    await this.stopPendingWork();
    await this.dependencies.checkpointStore.clearAll().catch(() => undefined);
    this.dependencies.conversationState.reset("incognito");
    this.dependencies.clearSelectedConversation();
    this.dependencies.recoveredDrafts.clear();
    this.dependencies.workspaceReferences.clear();
  }
}

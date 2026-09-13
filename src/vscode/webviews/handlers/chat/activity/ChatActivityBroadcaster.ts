import type * as vscode from "vscode";
import type { QueuedGenerationMessage } from "@/contracts";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SendMessagePayload, HistoryTransitionState } from "../Types";
import type { GenerationRunRecord } from "../generation/GenerationRun";
import {
  buildGenerationSnapshot,
  replayGenerationEvents,
} from "../generation/GenerationCheckpointing";

interface ChatActivityBroadcasterDependencies {
  coordinator: GenerationCoordinator<SendMessagePayload>;
  recoveredDrafts: ReadonlyMap<string, QueuedGenerationMessage[]>;
  runs: ReadonlyMap<string, GenerationRunRecord>;
  getHistoryTransition: () => HistoryTransitionState | undefined;
  getSelectedConversationId: () => string | undefined;
  getWebviewView: () => vscode.WebviewView | undefined;
  lastReplayedGeneration: WeakMap<object, string>;
}

export class ChatActivityBroadcaster {
  constructor(
    private readonly dependencies: ChatActivityBroadcasterDependencies,
  ) {}

  post(message: Record<string, unknown>): void {
    void this.dependencies.getWebviewView()?.webview.postMessage(message);
  }

  pendingWorkCounts(): { activeGenerations: number; queuedMessages: number } {
    const { coordinator } = this.dependencies;
    return {
      activeGenerations: coordinator.getActiveGenerations().length,
      queuedMessages: coordinator
        .getQueuedConversationIds()
        .reduce((total, id) => total + coordinator.getQueue(id).length, 0),
    };
  }

  postGenerationSnapshot(): void {
    const { coordinator, recoveredDrafts, runs } = this.dependencies;
    this.post(buildGenerationSnapshot(runs, recoveredDrafts, coordinator));
  }

  postGenerationActivity(
    conversationId: string,
    generationId: string | undefined,
    status: "queued" | "running" | "cancelling" | "settled",
  ): void {
    this.post({
      type: "generationActivityChanged",
      conversationId,
      generationId,
      status,
      queuedMessages: this.dependencies.coordinator.getQueue(conversationId).length,
    });
  }

  postAllGenerationActivity(): void {
    const { coordinator, runs } = this.dependencies;
    const activeConversations = new Set<string>();
    for (const active of coordinator.getActiveGenerations()) {
      activeConversations.add(active.task.conversationId);
      const record = runs.get(active.generationId);
      this.postGenerationActivity(
        active.task.conversationId,
        active.generationId,
        record?.status === "cancelling" ? "cancelling" : "running",
      );
    }
    for (const conversationId of coordinator.getQueuedConversationIds()) {
      if (!activeConversations.has(conversationId)) {
        this.postGenerationActivity(conversationId, undefined, "queued");
      }
    }
  }

  postHistoryTransitionActivity(): void {
    const transition = this.dependencies.getHistoryTransition();
    if (!transition || transition.phase !== "stop-work") {
      return;
    }
    this.post({
      type: "historyTransitionRequired",
      requestId: transition.requestId,
      phase: transition.phase,
      direction: transition.direction,
      ...this.pendingWorkCounts(),
    });
  }

  replaySelectedGeneration(): void {
    const {
      coordinator,
      getSelectedConversationId,
      getWebviewView,
      lastReplayedGeneration,
      runs,
    } = this.dependencies;
    const selectedConversationId = getSelectedConversationId();
    const active = selectedConversationId
      ? coordinator.getActiveForConversation(selectedConversationId)
      : undefined;
    const record = active ? runs.get(active.generationId) : undefined;
    replayGenerationEvents(record, getWebviewView(), lastReplayedGeneration);
  }
}

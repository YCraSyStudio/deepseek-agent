import assert from "node:assert/strict";
import type * as vscode from "vscode";
import type { QueuedGenerationMessage } from "@/contracts";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import { ChatActivityBroadcaster } from "@/vscode/webviews/handlers/chat/activity/ChatActivityBroadcaster";
import type { HistoryTransitionState, SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";

suite("chat activity broadcaster", () => {
  test("counts active and queued work", () => {
    const broadcaster = createBroadcaster([], {
      active: [
        { generationId: "generation-1", conversationId: "conversation-1" },
        { generationId: "generation-2", conversationId: "conversation-2" },
      ],
      queuedConversationIds: ["conversation-2", "conversation-3"],
      queues: { "conversation-2": 2, "conversation-3": 1 },
    });

    assert.deepStrictEqual(broadcaster.pendingWorkCounts(), {
      activeGenerations: 2,
      queuedMessages: 3,
    });
  });

  test("reports running, cancelling and queued conversations", () => {
    const messages: Array<Record<string, unknown>> = [];
    const broadcaster = createBroadcaster(messages, {
      active: [
        { generationId: "generation-1", conversationId: "conversation-1" },
        { generationId: "generation-2", conversationId: "conversation-2" },
      ],
      cancelling: new Set(["generation-2"]),
      queuedConversationIds: ["conversation-2", "conversation-3"],
      queues: { "conversation-1": 1, "conversation-3": 1 },
    });

    broadcaster.postAllGenerationActivity();

    assert.deepStrictEqual(messages, [
      {
        type: "generationActivityChanged",
        conversationId: "conversation-1",
        generationId: "generation-1",
        status: "running",
        queuedMessages: 1,
      },
      {
        type: "generationActivityChanged",
        conversationId: "conversation-2",
        generationId: "generation-2",
        status: "cancelling",
        queuedMessages: 0,
      },
      {
        type: "generationActivityChanged",
        conversationId: "conversation-3",
        generationId: undefined,
        status: "queued",
        queuedMessages: 1,
      },
    ]);
  });

  test("asks for a history transition only before the work stops", () => {
    const pending: Array<Record<string, unknown>> = [];
    createBroadcaster(pending, {
      active: [{ generationId: "generation-1", conversationId: "conversation-1" }],
      transition: { requestId: "request-1", direction: "enter-incognito", phase: "stop-work" },
    }).postHistoryTransitionActivity();

    assert.deepStrictEqual(pending, [
      {
        type: "historyTransitionRequired",
        requestId: "request-1",
        phase: "stop-work",
        direction: "enter-incognito",
        activeGenerations: 1,
        queuedMessages: 0,
      },
    ]);

    const resolved: Array<Record<string, unknown>> = [];
    createBroadcaster(resolved, {
      transition: { requestId: "request-1", direction: "enter-incognito", phase: "exit-incognito" },
    }).postHistoryTransitionActivity();
    createBroadcaster(resolved).postHistoryTransitionActivity();

    assert.deepStrictEqual(resolved, []);
  });

  test("forwards messages to the attached webview", () => {
    const messages: Array<Record<string, unknown>> = [];
    const broadcaster = createBroadcaster(messages);

    broadcaster.post({ type: "clearChat" });
    broadcaster.postGenerationSnapshot();

    assert.deepStrictEqual(messages.map((message) => message.type), [
      "clearChat",
      "generationSnapshot",
    ]);
  });
});

interface BroadcasterOptions {
  active?: Array<{ generationId: string; conversationId: string }>;
  cancelling?: Set<string>;
  queues?: Record<string, number>;
  queuedConversationIds?: string[];
  transition?: HistoryTransitionState;
}

function createBroadcaster(
  messages: Array<Record<string, unknown>>,
  options: BroadcasterOptions = {},
): ChatActivityBroadcaster {
  const cancelling = options.cancelling ?? new Set<string>();
  const queues = options.queues ?? {};
  const runs = new Map<string, GenerationRunRecord>(
    (options.active ?? [])
      .filter((active) => cancelling.has(active.generationId))
      .map((active) => [active.generationId, { status: "cancelling" } as unknown as GenerationRunRecord]),
  );
  return new ChatActivityBroadcaster({
    coordinator: {
      getActiveForConversation: (conversationId: string) =>
        (options.active ?? []).find((active) => active.conversationId === conversationId),
      getActiveGenerations: () =>
        (options.active ?? []).map((active) => ({
          ...active,
          completion: Promise.resolve(),
          task: { conversationId: active.conversationId },
        })),
      getQueue: (conversationId: string) => new Array(queues[conversationId] ?? 0).fill({}),
      getQueuedConversationIds: () => options.queuedConversationIds ?? [],
    } as unknown as GenerationCoordinator<SendMessagePayload>,
    getHistoryTransition: () => options.transition,
    getSelectedConversationId: () => undefined,
    getWebviewView: () =>
      ({
        webview: {
          postMessage: async (message: Record<string, unknown>) => {
            messages.push(message);
            return true;
          },
        },
      } as unknown as vscode.WebviewView),
    lastReplayedGeneration: new WeakMap<object, string>(),
    recoveredDrafts: new Map<string, QueuedGenerationMessage[]>(),
    runs,
  });
}

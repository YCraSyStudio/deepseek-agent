import assert from "node:assert/strict";
import type { QueuedGenerationMessage, WorkspaceBinding } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SettingsRepository } from "@/application/ports";
import type { GenerationCheckpointStore } from "@/vscode/storage";
import type { ChatActivityBroadcaster } from "@/vscode/webviews/handlers/chat/activity/ChatActivityBroadcaster";
import type { ConversationWorkspaceReferences } from "@/vscode/webviews/handlers/chat/session/ConversationWorkspaceReferences";
import { IncognitoSessionLifecycle } from "@/vscode/webviews/handlers/chat/session/IncognitoSessionLifecycle";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";

suite("incognito session lifecycle", () => {
  test("reports pending work and rejects a competing history transition", () => {
    const harness = createHarness({
      active: [{ generationId: "generation-1", conversationId: "conversation-1" }],
      queuedConversationIds: ["conversation-1", "conversation-2"],
    });

    assert.deepStrictEqual(
      harness.lifecycle.beginHistoryTransition("request-1", "enter-incognito"),
      { activeGenerations: 1, queuedMessages: 2 },
    );
    assert.strictEqual(harness.lifecycle.isTransitionActive(), true);
    assert.strictEqual(
      harness.lifecycle.beginHistoryTransition("request-2", "exit-incognito"),
      undefined,
    );
    assert.strictEqual(harness.lifecycle.getHistoryTransition()?.requestId, "request-1");
  });

  test("entering incognito stops work before clearing the webview", async () => {
    const events: string[] = [];
    const session = { cancel: () => events.push("session:cancel") };
    const runs = new Map<string, GenerationRunRecord>([
      ["generation-1", { status: "streaming", session } as unknown as GenerationRunRecord],
    ]);
    const harness = createHarness({
      active: [{ generationId: "generation-1", conversationId: "conversation-1" }],
      queuedConversationIds: ["conversation-1"],
      runs,
    }, events);

    harness.lifecycle.beginHistoryTransition("request-1", "enter-incognito");
    await harness.lifecycle.enterIncognito("request-1");

    assert.deepStrictEqual(events, [
      "queue:clear:conversation-1",
      "session:cancel",
      "interrupt:generation-1:history_transition",
      "checkpoints:clear",
      "references:clear",
      "reset:incognito",
      "selection:clear",
      "post:clearChat",
      "context:post",
      "snapshot",
    ]);
    assert.strictEqual(harness.recoveredDrafts.size, 0);
    assert.strictEqual(harness.lifecycle.isTransitionActive(), false);
  });

  test("discarding incognito persists the mode and cancels the transition", () => {
    const harness = createHarness();
    harness.lifecycle.beginHistoryTransition("request-1", "enter-incognito");

    harness.lifecycle.discardIncognito("request-1");

    assert.deepStrictEqual(harness.events, [
      "reset:persistent",
      "selection:clear",
      "references:clear",
      "post:clearChat",
      "context:post",
      "snapshot",
    ]);
    assert.strictEqual(harness.lifecycle.isTransitionActive(), false);
  });

  test("webview recreation only discards incognito state when history is disabled", async () => {
    const persisted = createHarness({ historyEnabled: true });
    await persisted.lifecycle.discardIncognitoForWebviewRecreation();
    assert.deepStrictEqual(persisted.events, []);

    const incognito = createHarness({ historyEnabled: false });
    await incognito.lifecycle.discardIncognitoForWebviewRecreation();
    assert.deepStrictEqual(incognito.events, [
      "checkpoints:clear",
      "reset:incognito",
      "selection:clear",
      "references:clear",
    ]);
  });

  test("reports incognito messages only for an active incognito conversation", () => {
    assert.strictEqual(
      createHarness({ incognito: true, hasMessages: true }).lifecycle.hasIncognitoMessages(),
      true,
    );
    assert.strictEqual(
      createHarness({ incognito: true, hasMessages: false }).lifecycle.hasIncognitoMessages(),
      false,
    );
    assert.strictEqual(
      createHarness({ incognito: false, hasMessages: true }).lifecycle.hasIncognitoMessages(),
      false,
    );
  });
});

interface HarnessOptions {
  active?: Array<{ generationId: string; conversationId: string }>;
  hasMessages?: boolean;
  historyEnabled?: boolean;
  incognito?: boolean;
  queuedConversationIds?: string[];
  runs?: Map<string, GenerationRunRecord>;
}

function createHarness(options: HarnessOptions = {}, events: string[] = []) {
  const recoveredDrafts = new Map<string, QueuedGenerationMessage[]>([
    ["conversation-1", [{ clientRequestId: "draft-1" } as QueuedGenerationMessage]],
  ]);
  const lifecycle = new IncognitoSessionLifecycle({
    broadcaster: {
      post: (message: Record<string, unknown>) => events.push(`post:${String(message.type)}`),
      postGenerationSnapshot: () => events.push("snapshot"),
      pendingWorkCounts: () => ({
        activeGenerations: options.active?.length ?? 0,
        queuedMessages: options.queuedConversationIds?.length ?? 0,
      }),
    } as unknown as ChatActivityBroadcaster,
    captureBinding: () => ({ uri: "file:///workspace" } as unknown as WorkspaceBinding),
    checkpointStore: {
      clearAll: async () => {
        events.push("checkpoints:clear");
      },
    } as unknown as GenerationCheckpointStore,
    clearSelectedConversation: () => events.push("selection:clear"),
    conversationState: {
      hasMessages: () => options.hasMessages ?? false,
      isIncognito: () => options.incognito ?? false,
      promoteIncognito: async () => events.push("promote"),
      reset: (mode: string) => events.push(`reset:${mode}`),
    } as unknown as ConversationState,
    coordinator: {
      clearQueue: (conversationId: string) => events.push(`queue:clear:${conversationId}`),
      getActiveGenerations: () =>
        (options.active ?? []).map((active) => ({
          ...active,
          completion: Promise.resolve(),
        })),
      getQueuedConversationIds: () => options.queuedConversationIds ?? [],
      interrupt: (generationId: string, reason: string) =>
        events.push(`interrupt:${generationId}:${reason}`),
    } as unknown as GenerationCoordinator<SendMessagePayload>,
    recoveredDrafts,
    runs: options.runs ?? new Map<string, GenerationRunRecord>(),
    settings: {
      load: () => ({ historyEnabled: options.historyEnabled ?? true }),
    } as unknown as SettingsRepository,
    workspaceReferences: {
      clear: () => events.push("references:clear"),
      postContext: () => events.push("context:post"),
    } as unknown as ConversationWorkspaceReferences,
  });
  return { events, lifecycle, recoveredDrafts };
}

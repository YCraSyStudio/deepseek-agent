import assert from "node:assert/strict";
import { ConversationState } from "@/application/chat/ConversationState";
import { restoreRequestedConversation } from "@/vscode/webviews/handlers/chat/session/ConversationRestoration";
import type { HistoryManager } from "@/vscode/storage";

suite("conversation restoration isolation", () => {
  test("a blank composer resets prior context instead of reusing it", async () => {
    const state = new ConversationState({ save: async () => undefined });
    await state.saveMessages({ messages: [state.createMessage("user", "Only in old chat")], model: "deepseek-chat" });
    await restoreRequestedConversation(undefined, state, {} as HistoryManager, () => undefined);
    assert.equal(state.getActiveConversationId(), undefined);
    assert.deepEqual(state.getApiMessages(), []);
  });

  test("a deleted conversation is rejected without inheriting another chat", async () => {
    const state = new ConversationState({ save: async () => undefined });
    await state.saveMessages({ messages: [state.createMessage("user", "Old chat")], model: "deepseek-chat" });
    const original = state.getActiveConversationId();
    await assert.rejects(restoreRequestedConversation("deleted", state, {
      getById: async () => undefined,
    } as unknown as HistoryManager, () => undefined), /Conversation not found/);
    assert.equal(state.getActiveConversationId(), original);
  });
});

import * as assert from "node:assert";
import type { HandlerToWebviewMessage } from "@/contracts";
import { acceptMessageForScope } from "@webview/views/chatView/hooks/GenerationEventScope";

suite("generation event scope", () => {
  const lateMessage: HandlerToWebviewMessage = {
    type: "addMessage",
    conversationId: "conversation-a",
    generationId: "generation-a",
    message: {
      role: "assistant",
      content: "late content",
      generationId: "generation-a",
    },
  };

  test("rejects events from a cancelled chat while a new blank chat is selected", () => {
    assert.strictEqual(acceptMessageForScope(lateMessage, {}), false);
  });

  test("accepts the first user message immediately after admission, before a render", () => {
    const conversationId = { current: undefined as string | undefined };
    const generationId = { current: undefined as string | undefined };
    const getScope = () => ({ conversationId: conversationId.current, activeGenerationId: generationId.current });
    const firstMessage: HandlerToWebviewMessage = {
      ...lateMessage,
      message: { role: "user", content: "First message", generationId: "generation-a" },
    };

    assert.strictEqual(acceptMessageForScope(firstMessage, getScope), false);
    conversationId.current = "conversation-a";
    generationId.current = "generation-a";
    assert.strictEqual(acceptMessageForScope(firstMessage, getScope), true);
    assert.strictEqual(acceptMessageForScope({
      type: "showTyping", conversationId: "conversation-a", generationId: "generation-a",
    }, getScope), true);

    generationId.current = "generation-b";
    assert.strictEqual(acceptMessageForScope(firstMessage, getScope), false);
    conversationId.current = undefined;
    generationId.current = undefined;
    assert.strictEqual(acceptMessageForScope(lateMessage, getScope), false);
  });

  test("rejects another conversation and another generation", () => {
    assert.strictEqual(acceptMessageForScope(lateMessage, {
      conversationId: "conversation-b",
      activeGenerationId: "generation-b",
    }), false);
    assert.strictEqual(acceptMessageForScope(lateMessage, {
      conversationId: "conversation-a",
      activeGenerationId: "generation-b",
    }), false);
  });

  test("accepts only the selected generation and allows global snapshots", () => {
    assert.strictEqual(acceptMessageForScope(lateMessage, {
      conversationId: "conversation-a",
      activeGenerationId: "generation-a",
    }), true);
    assert.strictEqual(acceptMessageForScope({
      type: "generationSnapshot",
      generations: [],
      recoveredDrafts: [],
    }, {}), true);
  });
});

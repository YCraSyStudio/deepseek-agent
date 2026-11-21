import * as assert from "assert";
import { isConversation } from "@/application/chat/ConversationValidation";

suite("history validation", () => {
  test("accepts native timeline history and rejects malformed persisted data", () => {
    const conversation = {
      schemaVersion: 2,
      id: "conversation-1",
      title: "Test",
      createdAt: 1,
      updatedAt: 2,
      model: "model",
      workspaceUri: "file:///workspace",
      workspaceBinding: {
        schemaVersion: 1,
        uri: "file:///workspace",
        name: "workspace",
        revision: "test",
        folders: [],
        capabilities: { files: true, search: true, git: true, terminal: true },
      },
      messages: [
        { id: "user-1", role: "user", content: "hello" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "done",
          contextContent: "done",
          timeline: [
            { id: "reasoning-1", type: "reasoning", content: "think" },
            { id: "tool-1", type: "tool-group", round: 1, toolCallIds: ["call-1"] },
            { id: "content-1", type: "content", content: "done" },
          ],
        },
      ],
    };

    assert.strictEqual(isConversation({ ...conversation, schemaVersion: undefined }), false);
    assert.strictEqual(isConversation({ ...conversation, schemaVersion: 2 }), true);
    assert.strictEqual(isConversation({ ...conversation, schemaVersion: 3 }), false);
    assert.strictEqual(isConversation({ ...conversation, workspaceUri: "file:///different" }), false);
    assert.strictEqual(isConversation({ ...conversation, contextSummary: { schemaVersion: 1 } }), false);
    assert.strictEqual(isConversation({ ...conversation, messages: [{ id: "x", role: "root", content: "bad" }] }), false);
    assert.strictEqual(isConversation({ ...conversation, messages: [{ id: "x", role: "assistant", content: "", timeline: [{ id: "x", type: "tool-group", round: 0, toolCallIds: [] }] }] }), false);
    assert.strictEqual(isConversation({ ...conversation, messages: [{ id: "x", role: "assistant", content: "", contextContent: 42 }] }), false);
    assert.strictEqual(isConversation({ ...conversation, messages: [{ id: "x", role: "assistant", content: "", providerTranscript: { status: "complete" } }] }), false);
  });
});

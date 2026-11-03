import * as assert from "assert";
import type { Conversation } from "@/contracts";
import { findDuplicateConversationIds } from "@/application/chat/ConversationDeduplication";

suite("conversation history deduplication", () => {
  test("removes contained fragments but keeps unrelated conversations", () => {
    const complete = conversation("complete", ["user-1", "assistant-1", "user-2", "assistant-2"], 20);
    const fragment = conversation("fragment", ["user-1", "assistant-1"], 10);
    const unrelated = conversation("unrelated", ["other-user", "other-assistant"], 30);

    assert.deepStrictEqual([...findDuplicateConversationIds([fragment, unrelated, complete])], ["fragment"]);
  });

  test("does not merge matching message ids across workspaces", () => {
    const first = conversation("first", ["user-1", "assistant-1"], 10);
    const second = { ...conversation("second", ["user-1", "assistant-1", "user-2"], 20), workspaceUri: "file:///other" };
    assert.strictEqual(findDuplicateConversationIds([first, second]).size, 0);
  });
});

function conversation(id: string, messageIds: string[], updatedAt: number): Conversation {
  return {
    schemaVersion: 2,
    id,
    title: id,
    createdAt: 1,
    updatedAt,
    model: "test-model",
    workspaceUri: "file:///workspace",
    workspaceBinding: testWorkspaceBinding(),
    messages: messageIds.map((messageId, index) => ({
      id: messageId,
      role: index % 2 === 0 ? "user" : "assistant",
      content: messageId,
      createdAt: index + 1,
    })),
  };
}

function testWorkspaceBinding() {
  return {
    schemaVersion: 1 as const,
    uri: "file:///workspace",
    name: "workspace",
    revision: "test",
    folders: [],
    capabilities: { files: true, search: true, git: true, terminal: true },
  };
}

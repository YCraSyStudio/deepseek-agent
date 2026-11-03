import * as assert from "assert";
import {
  createProviderTranscript,
  isProviderTranscript,
  toPresentationConversation,
  type StoredConversation,
} from "@/application/chat/ProviderTranscript";

suite("canonical provider transcript", () => {
  test("accepts complete ordered tool rounds and preserves large required reasoning", () => {
    const reasoning = "r".repeat(30_000);
    const transcript = createProviderTranscript([
      {
        role: "assistant",
        content: null,
        reasoning_content: reasoning,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call-1", name: "read_file", content: "result" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "Need another file.",
        tool_calls: [{
          id: "call-2",
          type: "function",
          function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call-2", name: "read_file", content: "second result" },
      { role: "assistant", content: "Final", reasoning_content: "done" },
    ], "complete", "stop");

    assert.strictEqual(isProviderTranscript(transcript), true);
    assert.strictEqual(transcript.finishReason, "stop");
    assert.strictEqual(transcript.messages[0].reasoning_content?.length, 30_000);
  });

  test("rejects malformed JSON and orphaned tool results", () => {
    assert.strictEqual(isProviderTranscript({
      schemaVersion: 1,
      provider: "deepseek",
      status: "complete",
      messages: [{
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: "not-json" },
        }],
      }],
    }), false);
    assert.strictEqual(isProviderTranscript({
      schemaVersion: 1,
      provider: "deepseek",
      status: "complete",
      messages: [{ role: "tool", tool_call_id: "missing", name: "read_file", content: "result" }],
    }), false);
  });

  test("removes provider transcript and context summary from webview presentation", () => {
    const conversation: StoredConversation = {
      schemaVersion: 2,
      id: "conversation",
      title: "Hidden",
      createdAt: 1,
      updatedAt: 1,
      model: "deepseek-flash",
      workspaceUri: "file:///workspace",
      workspaceBinding: {
        schemaVersion: 1,
        uri: "file:///workspace",
        name: "workspace",
        revision: "test",
        folders: [],
        capabilities: { files: true, search: true, git: true, terminal: true },
      },
      contextSummary: {
        schemaVersion: 2,
        provider: "local",
        content: "private summary",
        coveredGenerationIds: ["generation"],
        sourceDigest: "digest",
        updatedAt: 1,
      },
      messages: [{
        id: "assistant",
        role: "assistant",
        content: "Visible",
        createdAt: 1,
        contextContent: "Visible",
        providerTranscript: createProviderTranscript([
          { role: "assistant", content: "Visible", reasoning_content: "hidden" },
        ], "complete"),
      }],
    };

    const presentation = toPresentationConversation(conversation);
    assert.strictEqual("contextSummary" in presentation, false);
    assert.strictEqual("providerTranscript" in presentation.messages[0], false);
    assert.strictEqual("contextContent" in presentation.messages[0], false);
  });
});

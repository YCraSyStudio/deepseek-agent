import assert from "node:assert/strict";
import { normalizeConversation, toConversationSummary } from "@/vscode/storage/ConversationNormalization";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import { createProviderTranscript } from "@/application/chat/ProviderTranscript";
import type { StoredToolCall } from "@/contracts";

suite("stored conversation normalization", () => {
  const conversation = (): StoredConversation => ({ schemaVersion: 2, id: "chat", title: "Saved", model: "deepseek-flash", createdAt: 1, updatedAt: 2,
    workspaceUri: "old-uri", workspaceBinding: { schemaVersion: 1, uri: "file:///current", name: "Current", revision: "r", folders: [],
      capabilities: { files: true, search: true, git: true, terminal: true } }, messages: [] });
  const call = (status: StoredToolCall["status"], result?: string): StoredToolCall => ({ toolCallId: "call", toolName: "read_file", arguments: "{}", status, result, requiresConfirmation: true, isError: true });
  for (const status of ["pending", "awaiting_confirmation", "running"] as const) {
    test(`marks abandoned ${status} tool calls cancelled and preserves an existing result`, () => {
      const input = conversation(); input.messages = [{ id: "answer", role: "assistant", content: "Partial", toolCalls: [call(status), call(status, "Existing result")] }];
      const output = normalizeConversation(input);
      assert.equal(output.workspaceUri, "file:///current");
      const tools = output.messages[0].toolCalls!;
      assert.deepEqual(tools.map(tool => tool.status), ["cancelled", "cancelled"]);
      assert.equal(tools[0].result, "Interrupted because the extension host stopped."); assert.equal(tools[1].result, "Existing result");
      assert.equal(tools[0].isError, false); assert.equal(tools[0].requiresConfirmation, false); assert.equal(tools[0].dangerConfirmation, undefined);
      assert.equal(input.messages[0].toolCalls![0].status, status);
    });
  }
  test("compacts only oversized web results while preserving other terminal results", () => {
    const input = conversation(); const long = "x".repeat(8193);
    input.messages = [{ id: "answer", role: "assistant", content: "Done", toolCalls: [
      { ...call("completed", long), toolName: "search_web" }, { ...call("error", long), toolName: "read_web" },
      call("completed", long), { ...call("completed", "x".repeat(8192)), toolName: "read_web" }, call("rejected"),
    ] }];
    const output = normalizeConversation(input); const tools = output.messages[0].toolCalls!;
    for (const tool of tools.slice(0, 2)) { assert.match(tool.result!, /\[Web result compacted\]$/); assert.ok(tool.result!.length < 8192); }
    assert.equal(tools[2].result, long); assert.equal(tools[3].result!.length, 8192); assert.equal(tools[4].status, "rejected");
    assert.equal(input.messages[0].toolCalls![0].result, long);
  });
  test("retains completed answer reasoning and independent summary metadata on reload", () => {
    const input = conversation(); input.contextSummary = { schemaVersion: 2, provider: "local", content: "Summary", coveredGenerationIds: ["generation"], sourceDigest: "digest", updatedAt: 2 };
    input.messages = [{ id: "answer", role: "assistant", content: "Displayed", providerTranscript: createProviderTranscript([
      { role: "assistant", content: "Final answer", reasoning_content: "Final reasoning" },
    ], "complete") }];
    const output = normalizeConversation(input);
    assert.equal(output.messages[0].contextContent, "Final answer"); assert.equal(output.messages[0].content, "Displayed");
    assert.equal(output.messages[0].providerTranscript?.messages[0].reasoning_content, "Final reasoning");
    output.contextSummary!.coveredGenerationIds.push("other"); assert.deepEqual(input.contextSummary.coveredGenerationIds, ["generation"]);
    assert.deepEqual(toConversationSummary(output, 123), { id: "chat", title: output.title, model: "deepseek-flash", createdAt: 1, updatedAt: 2, messageCount: 1, sizeBytes: 123, workspaceUri: "file:///current" });
  });
});

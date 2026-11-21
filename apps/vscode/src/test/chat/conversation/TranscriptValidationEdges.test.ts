import assert from "node:assert/strict";
import {
  compactCompletedProviderTranscript, createProviderTranscript, getFinalAssistantContent,
  isConversationContextSummary, isProviderTranscript, sanitizeStoredTranscript,
} from "@/application/chat/ProviderTranscript";
import type { ChatMessage } from "@/contracts";

suite("stored provider transcript validation edges", () => {
  const call = { id: "call", type: "function" as const, function: { name: "read_file", arguments: "{}" } };
  const envelope = (messages: unknown[], status = "incomplete") => ({ schemaVersion: 1, provider: "deepseek", status, messages });
  test("rejects invalid message fields before persisting or sanitizing a transcript", () => {
    const large = "x".repeat(5 * 1024 * 1024 + 1);
    for (const message of [null, { role: "user", content: "wrong role" }, { role: "assistant", content: 1 },
      { role: "assistant", content: large }, { role: "assistant", content: "", reasoning_content: 1 },
      { role: "assistant", content: "", tool_call_id: "x".repeat(513) }, { role: "assistant", content: "", name: "x".repeat(257) },
      { role: "assistant", content: "", tool_calls: {} }, { role: "assistant", content: "", tool_calls: Array(1001).fill(call) }]) {
      const value = envelope([message]);
      assert.equal(isProviderTranscript(value), false); assert.equal(sanitizeStoredTranscript(value), undefined);
    }
    assert.throws(() => createProviderTranscript([{ role: "tool", content: "orphan", tool_call_id: "missing" }], "complete"), /protocol-invalid/);
  });
  test("rejects malformed tool definitions and unresolved or reused protocol identifiers", () => {
    for (const invalid of [null, { ...call, id: 1 }, { ...call, type: "other" }, { ...call, function: null },
      { ...call, function: { name: 1, arguments: "{}" } }, { ...call, function: { name: "read_file", arguments: 1 } }]) {
      assert.equal(isProviderTranscript(envelope([{ role: "assistant", content: null, tool_calls: [invalid] }])), false);
    }
    const assistant = { role: "assistant", content: null, tool_calls: [call] };
    const tool = { role: "tool", content: "result", tool_call_id: "call" };
    for (const messages of [[assistant, { role: "assistant", content: "premature" }],
      [{ ...assistant, tool_calls: [call, call] }], [assistant, tool, assistant], [assistant, tool, tool]]) {
      assert.equal(isProviderTranscript(envelope(messages)), false);
    }
    assert.equal(isProviderTranscript(envelope([assistant])), true);
    assert.equal(isProviderTranscript(envelope([assistant], "complete")), false);
    assert.equal(isProviderTranscript(envelope([assistant, tool], "complete")), false);
    assert.equal(isProviderTranscript(envelope([], "complete")), false);
  });
  test("keeps independent reasoning copies and handles absent or non-final answers", () => {
    assert.equal(getFinalAssistantContent(undefined), undefined);
    const incomplete = createProviderTranscript([{ role: "assistant", content: null, tool_calls: [call] }], "incomplete");
    assert.equal(getFinalAssistantContent(incomplete), undefined); assert.equal(compactCompletedProviderTranscript(incomplete), incomplete);
    const complete = createProviderTranscript([{ role: "assistant", content: "  ", reasoning_content: "reasoning" }], "complete");
    assert.equal(getFinalAssistantContent(complete), undefined);
    const compact = compactCompletedProviderTranscript(complete)!; compact.messages[0].reasoning_content = "changed";
    assert.equal(complete.messages[0].reasoning_content, "reasoning");
    const withoutFinal = { ...incomplete, status: "complete" as const };
    assert.equal(compactCompletedProviderTranscript(withoutFinal), undefined);
    const withToolTail = { ...complete, messages: [...complete.messages, { role: "tool", content: "tail", tool_call_id: "call" } as ChatMessage] };
    assert.equal(compactCompletedProviderTranscript(withToolTail)?.messages.length, 1);
    assert.equal(getFinalAssistantContent(withToolTail), undefined);
  });
  test("rejects malformed summaries and compaction boundaries", () => {
    const boundary = { id: "boundary", createdAt: 1, reason: "manual_recovery", estimatedTokensBefore: 10, estimatedTokensAfter: 5, coveredGenerationIds: ["generation"], sourceDigest: "digest" };
    const summary = { schemaVersion: 2, provider: "local", content: "summary", coveredGenerationIds: ["generation"], sourceDigest: "digest", updatedAt: 1, boundaries: [boundary] };
    assert.equal(isConversationContextSummary(summary), true); assert.equal(isConversationContextSummary(null), false);
    for (const patch of [{ schemaVersion: 1 }, { provider: "other" }, { content: 1 }, { coveredGenerationIds: {} },
      { coveredGenerationIds: [1] }, { coveredGenerationIds: Array(10001).fill("id") }, { sourceDigest: "x".repeat(257) },
      { updatedAt: -1 }, { updatedAt: 1.5 }, { boundaries: {} }, { boundaries: Array(1001).fill(boundary) }, { boundaries: [null] }]) {
      assert.equal(isConversationContextSummary({ ...summary, ...patch }), false);
    }
    for (const patch of [{ id: 1 }, { createdAt: -1 }, { reason: "unknown" }, { estimatedTokensBefore: -1 },
      { estimatedTokensAfter: 1.5 }, { coveredGenerationIds: [1] }, { sourceDigest: null }]) {
      assert.equal(isConversationContextSummary({ ...summary, boundaries: [{ ...boundary, ...patch }] }), false);
    }
  });
});

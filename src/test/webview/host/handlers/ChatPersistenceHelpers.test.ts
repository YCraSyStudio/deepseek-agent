import assert from "node:assert/strict";
import { recordToolCycleCompaction } from "@/vscode/webviews/handlers/chat/generation/GenerationCompactionRecorder";
import { GenerationResultStore } from "@/vscode/webviews/handlers/chat/generation/GenerationResultStore";
import { getAvailableToolMetadata } from "@/vscode/webviews/handlers/chat/toolCalls/ToolMetadata";
import { restoreRequestedConversation } from "@/vscode/webviews/handlers/chat/session/ConversationRestoration";
import { insertImageReference } from "@/ui/views/chatView/utils/ImageReference";
import { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";
import type { ToolDefinition } from "@/contracts";
import type { HistoryManager } from "@/vscode/storage";
import { createUsageAggregate } from "@/shared/usage/Usage";

suite("chat persistence helpers", () => {
  test("records a tool-cycle compaction boundary while preserving the previous summary", async () => {
    const savedSummaries: unknown[] = [];
    const savedMessages: unknown[] = [];
    const synced: ConversationState[] = [];
    const previous = {
      schemaVersion: 2, provider: "deepseek", content: "Previous summary", coveredGenerationIds: ["old"],
      sourceDigest: "previous-digest", updatedAt: 1,
      boundaries: [{ id: "old-boundary", createdAt: 1, reason: "tool_cycle_rollover", estimatedTokensBefore: 10, estimatedTokensAfter: 5, coveredGenerationIds: [], sourceDigest: "old" }],
    };
    const state = {
      getConversation: () => ({ contextSummary: previous }),
      saveContextSummary: async (summary: unknown) => { savedSummaries.push(summary); },
      saveMessages: async (options: unknown) => { savedMessages.push(options); },
      createMessage: (role: string, content: string, extra: Record<string, unknown>) => ({ id: "context", role, content, ...extra }),
    } as unknown as ConversationState;
    await recordToolCycleCompaction({ state, generationId: "generation", model: "deepseek-flash", estimatedTokensBefore: 900, estimatedTokensAfter: 200, syncSelectedConversation: (value) => { synced.push(value); } });
    const summary = savedSummaries[0] as { content: string; provider: string; sourceDigest: string; boundaries: Array<Record<string, unknown>> };
    assert.equal(summary.content, "Previous summary");
    assert.equal(summary.provider, "deepseek");
    assert.equal(summary.sourceDigest, "previous-digest");
    assert.equal(summary.boundaries.length, 2);
    assert.equal(summary.boundaries[1].reason, "tool_cycle_rollover");
    assert.equal(summary.boundaries[1].estimatedTokensAfter, 200);
    assert.deepEqual(savedMessages, [{ messages: [{ id: "context", role: "context", content: "Context automatically compacted", generationId: "generation" }], model: "deepseek-flash" }]);
    assert.deepEqual(synced, [state]);
  });

  test("records a first compaction boundary for a conversation without a summary", async () => {
    const saved: Array<{ provider: string; content: string; boundaries: unknown[] }> = [];
    const state = {
      getConversation: () => undefined,
      saveContextSummary: async (summary: { provider: string; content: string; boundaries: unknown[] }) => { saved.push(summary); },
      saveMessages: async () => undefined,
      createMessage: () => ({}),
    } as unknown as ConversationState;
    await recordToolCycleCompaction({ state, generationId: "generation", model: "deepseek-flash", estimatedTokensBefore: 1, estimatedTokensAfter: 1, syncSelectedConversation: () => undefined });
    assert.equal(saved[0].provider, "local");
    assert.equal(saved[0].content, "");
    assert.equal(saved[0].boundaries.length, 1);
  });

  test("restores a requested conversation only when it differs from the active one", async () => {
    let resets = 0;
    const loaded: string[] = [];
    const state = {
      reset: () => { resets++; },
      getActiveConversationId: () => "active",
    } as unknown as ConversationState;
    const history = { getById: async (id: string) => id === "stored" ? { id } : undefined } as unknown as HistoryManager;
    await restoreRequestedConversation(undefined, state, history, () => undefined);
    assert.equal(resets, 1);
    await restoreRequestedConversation("active", state, history, () => undefined);
    await restoreRequestedConversation("stored", state, history, (conversation) => { loaded.push(conversation.id); });
    assert.deepEqual(loaded, ["stored"]);
    await assert.rejects(restoreRequestedConversation("missing", state, history, () => undefined), /Conversation not found/);
  });

  test("summarizes tool definitions with missing and alternate schemas", () => {
    const definitions = [
      { type: "function", function: { name: "full", description: "Desc", parameters: { type: "object", properties: { path: { type: "string", description: "Path" }, count: { type: "number" } }, required: ["path"] } } },
      { type: "function", function: { name: "empty", parameters: {} } },
      { type: "function", function: { name: "odd", parameters: { properties: [1, 2], required: "path" } } },
    ] as unknown as ToolDefinition[];
    const metadata = getAvailableToolMetadata(definitions);
    assert.deepEqual(metadata[0], { name: "full", description: "Desc", parameters: [{ name: "path", type: "string", required: true, description: "Path" }, { name: "count", type: "number", required: false, description: "" }] });
    assert.deepEqual(metadata[1], { name: "empty", description: "", parameters: [] });
    assert.deepEqual(metadata[2], { name: "odd", description: "", parameters: [] });
  });

  test("inserts image references at clamped selections with required spacing", () => {
    assert.deepEqual(insertImageReference("hello world", 5, 5, "[image 1]"), { text: "hello [image 1] world", caret: 15 });
    assert.deepEqual(insertImageReference("start", 0, 0, "[image 1]"), { text: "[image 1] start", caret: 10 });
    assert.deepEqual(insertImageReference("end ", 4, 4, "[image 1]"), { text: "end [image 1]", caret: 13 });
    assert.deepEqual(insertImageReference("replace me", 8, 10, "[image 1]"), { text: "replace [image 1]", caret: 17 });
    assert.deepEqual(insertImageReference("abc", Number.NaN, Number.NaN, "x"), { text: "abc x", caret: 5 });
    assert.deepEqual(insertImageReference("abc", -5, 99, "x"), { text: "x", caret: 1 });
  });

  function state(): ConversationState {
    const saved: unknown[] = [];
    return {
      saveMessages: async (options: unknown) => { saved.push(options); },
      createMessage: (role: string, content: string, extra: Record<string, unknown> = {}) => ({ id: `${role}-${saved.length}`, role, content, ...extra }),
      getConversation: () => ({ messages: [] }),
    } as unknown as ConversationState;
  }

  function record(status: GenerationRunRecord["status"] = "streaming"): GenerationRunRecord {
    return {
      generationId: "generation", conversationId: "chat", clientRequestId: "request", state: state(),
      session: {} as GenerationRunRecord["session"], content: "", timeline: [], toolCalls: [], status,
      eventLog: [], budgetManager: {} as GenerationRunRecord["budgetManager"],
    };
  }

  test("saves a completed assistant message, usage and run metadata", async () => {
    const run = record();
    const target = state();
    let synced = 0;
    const store = new GenerationResultStore({ runs: new Map([[run.generationId, run]]), syncSelectedConversation: () => { synced++; } });
    await store.save({
      content: "Answer", timeline: [{ id: "text", type: "content", content: "Answer" }], model: "deepseek-flash",
      toolCalls: [], state: target, generationId: "generation", status: "completed",
      usage: createUsageAggregate(true, "deepseek-flash"),
    });
    assert.equal(synced, 1);
    assert.equal(run.status, "completed");
    assert.equal(run.content, "Answer");
    assert.equal(run.errorPersisted, false);
  });

  test("saves error-only turns and persists both assistant and error when partial output exists", async () => {
    const messages: Array<Array<Record<string, unknown>>> = [];
    const target = {
      saveMessages: async ({ messages: batch }: { messages: Array<Record<string, unknown>> }) => { messages.push(batch); },
      createMessage: (role: string, content: string, extra: Record<string, unknown> = {}) => ({ role, content, ...extra }),
      getConversation: () => ({ messages: [] }),
    } as unknown as ConversationState;
    const store = new GenerationResultStore({ runs: new Map(), syncSelectedConversation: () => undefined });
    await store.save({ content: "", timeline: [], model: "deepseek-flash", state: target, generationId: "generation", status: "error", error: "Provider failed" });
    assert.equal(messages[0].length, 1);
    assert.equal(messages[0][0].role, "error");
    await store.save({ content: "Partial", timeline: [], model: "deepseek-flash", state: target, generationId: "generation", status: "interrupted", error: "Connection lost" });
    assert.equal(messages[1].length, 2);
    assert.equal(messages[1][0].role, "assistant");
    assert.match(String(messages[1][0].contextContent), /Partial assistant response: Partial/);
    assert.equal(messages[1][1].role, "error");
  });

  test("does not duplicate an already persisted terminal assistant and handles cancellation transitions", async () => {
    let saves = 0;
    const existingState = {
      getConversation: () => ({ messages: [{ role: "assistant", generationId: "generation" }] }),
      saveMessages: async () => { saves++; },
    } as unknown as ConversationState;
    const run = record("streaming");
    run.state = existingState;
    const store = new GenerationResultStore({ runs: new Map([[run.generationId, run]]), syncSelectedConversation: () => undefined });
    await store.persistTerminalAssistant(run, "deepseek-flash", "interrupted", "workspace_changed");
    assert.equal(saves, 0);
    run.state = state();
    await store.persistTerminalAssistant(run, "deepseek-flash", "interrupted", "workspace_changed");
    assert.equal(run.status, "interrupted");
    const cancelled = record("streaming");
    store.transitionToTerminal(cancelled, "cancelled");
    assert.equal(cancelled.status, "cancelled");
    store.logCompletedToolsNotRolledBack({ ...cancelled, toolCalls: [{ status: "completed" }] } as unknown as GenerationRunRecord);
    store.logCompletedToolsNotRolledBack({ ...cancelled, toolCalls: [{ status: "completed" }] } as unknown as GenerationRunRecord);
  });
});

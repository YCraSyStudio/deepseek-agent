import assert from "node:assert/strict";
import { ManualCompaction } from "@/vscode/webviews/handlers/chat/context/ManualCompaction";
import { ConversationState } from "@/application/chat/ConversationState";
import { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { ModelProvider, SettingsRepository } from "@/application/ports";
import { DEFAULT_CONFIG, type AppConfig } from "@/contracts";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";

suite("manual context compaction public workflow", () => {
  let state: ConversationState; let coordinator: GenerationCoordinator<SendMessagePayload>; let compaction: ManualCompaction;
  let posts: Array<Record<string, unknown>>; let saved: StoredConversation[]; let selected: string | undefined; let historyTransition: boolean; let key: string | undefined;
  let respond: ModelProvider["chatCompletion"]; let calls: number; let config: AppConfig; let saveError: Error | undefined; let factoryError: unknown;
  setup(() => {
    posts = []; saved = []; selected = "chat"; historyTransition = false; key = "test-key"; calls = 0; config = { ...DEFAULT_CONFIG }; saveError = undefined; factoryError = undefined;
    state = new ConversationState({ save: async (conversation) => { if (saveError) { throw saveError; } saved.push(structuredClone(conversation)); } });
    seed(); let nextId = 0;
    coordinator = new GenerationCoordinator({ idGenerator: { next: () => `generation-${++nextId}` }, getLimit: () => 1,
      run: async (_id, _task, signal) => new Promise<void>((resolve) => { if (signal.aborted) { resolve(); } else { signal.addEventListener("abort", () => resolve(), { once: true }); } }) });
    respond = async () => ({ id: "summary", object: "chat.completion", created: 1, model: config.model, choices: [{ index: 0, message: { role: "assistant", content: "Keep the requested constraints and completed result." }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
    const provider: ModelProvider = { id: "fixture", name: "Fixture", chatCompletion: async (...args) => { calls++; return respond(...args); }, chatCompletionStream: async () => { throw new Error("Unexpected streaming request"); }, testConnection: async () => ({ success: true }), listModels: async () => [] };
    compaction = new ManualCompaction({ conversationState: state, coordinator, settings: { load: () => config } as SettingsRepository,
      secrets: { getApiKey: async () => key, migrateLegacyApiKey: async () => undefined, setApiKey: async () => undefined, deleteApiKey: async () => undefined },
      modelProviderFactory: { create: () => { if (factoryError !== undefined) { throw factoryError; } return provider; } },
      getSelectedConversationId: () => selected, hasHistoryTransition: () => historyTransition, post: (post) => { posts.push(post); } });
  });
  teardown(async () => { compaction.dispose(); await coordinator.shutdown(); });
  function seed(messages = true) {
    state.load({ schemaVersion: 2, id: "chat", title: "Chat", createdAt: 1, updatedAt: 1, model: DEFAULT_CONFIG.model, workspaceUri: "", workspaceBinding: { schemaVersion: 1, uri: "", name: "Empty", revision: "1", folders: [], capabilities: { files: false, search: false, git: false, terminal: false } },
      messages: messages ? [{ id: "user", role: "user", content: "Respect these requirements. ".repeat(100), generationId: "turn" }, { id: "assistant", role: "assistant", content: "Completed the requested change.", generationId: "turn", generationStatus: "completed" }] : [] });
  }
  function enqueue(conversationId: string, id: string) { coordinator.enqueue({ conversationId, clientRequestId: id, queuedAt: 1, payload: { clientRequestId: id, text: "question", modelId: DEFAULT_CONFIG.model, reasoning: "off" } }); }
  function result(requestId = "request") { const found = posts.find((post) => post.type === "contextCompactionResult" && post.requestId === requestId); assert.ok(found); return found; }
  test("only the open selected conversation can be compacted", async () => {
    selected = undefined; await compaction.compact("none"); assert.match(result("none").error as string, /Only the conversation that is open/);
    selected = "chat"; await compaction.compact("wrong", "other"); assert.equal(result("wrong").status, "failed"); assert.equal(calls, 0);
  });
  test("pending history transitions prevent compaction without changing the conversation", async () => {
    historyTransition = true; await compaction.compact("request", "chat"); assert.match(result().error as string, /pending history change/); assert.equal(calls, 0); assert.deepEqual(saved, []);
  });
  test("an active generation prevents compaction", async () => {
    enqueue("chat", "active"); await compaction.compact("request", "chat"); assert.match(result().error as string, /running generation/); assert.equal(calls, 0);
  });
  test("a queued generation prevents compaction even when another chat owns the running slot", async () => {
    enqueue("other", "active"); enqueue("chat", "queued"); assert.equal(coordinator.getQueue("chat").length, 1);
    await compaction.compact("request", "chat"); assert.match(result().error as string, /running generation/); assert.equal(calls, 0);
  });
  test("empty context is reported before requesting credentials or a model", async () => {
    seed(false); key = undefined; await compaction.compact("request"); assert.deepEqual(result(), { type: "contextCompactionResult", requestId: "request", status: "empty" }); assert.equal(calls, 0);
  });
  test("missing credentials report a correlated failure", async () => {
    key = undefined; await compaction.compact("request"); assert.match(result().error as string, /API key is not configured/); assert.equal(result().status, "failed"); assert.deepEqual(saved, []);
  });
  test("saves the summary and visible marker, then publishes context and usage", async () => {
    await compaction.compact("request", "chat"); const conversation = state.getConversation()!;
    assert.equal(result().status, "compacted"); assert.equal(typeof result().freedTokens, "number"); assert.ok((result().freedTokens as number) >= 0);
    assert.equal(conversation.contextSummary?.provider, "deepseek"); assert.deepEqual(conversation.contextSummary?.coveredGenerationIds, ["turn"]);
    assert.equal(conversation.messages.at(-1)?.role, "context"); assert.equal(conversation.messages.at(-1)?.generationId, "manual-compaction:request"); assert.ok(conversation.messages.at(-1)?.usage);
    assert.ok(posts.some((post) => post.type === "contextWindowUpdated" && post.conversationId === "chat")); assert.ok(posts.some((post) => post.type === "conversationUsageUpdated")); assert.ok(saved.length >= 2); assert.equal(calls, 1);
  });
  test("an unavailable provider falls back to a local summary rather than discarding context", async () => {
    respond = async () => { throw new Error("offline"); }; await compaction.compact("request"); assert.equal(result().status, "compacted"); assert.equal(state.getConversation()!.contextSummary?.provider, "local"); assert.match(state.getConversation()!.contextSummary!.content, /Respect these requirements/);
  });
  test("concurrent compaction is rejected and disposal cancels the running request", async () => {
    let started!: () => void; const pending = new Promise<void>((resolve) => { started = resolve; });
    respond = async (_request, signal) => { started(); return new Promise((_resolve, reject) => { signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }); }); };
    const first = compaction.compact("first"); await pending; await compaction.compact("second"); assert.match(result("second").error as string, /already running/);
    compaction.dispose(); await first; assert.equal(result("first").status, "failed"); assert.deepEqual(saved, []);
    respond = async () => { throw new Error("offline"); }; await compaction.compact("retry"); assert.equal(result("retry").status, "compacted");
  });
  test("factory errors preserve their message and release the compaction lock", async () => {
    factoryError = "factory unavailable"; await compaction.compact("request"); assert.equal(result().error, "factory unavailable");
    factoryError = undefined; await compaction.compact("retry"); assert.equal(result("retry").status, "compacted");
  });
  test("summary persistence errors are reported without a false success result", async () => {
    saveError = new Error("storage unavailable"); await compaction.compact("request"); assert.equal(result().status, "failed"); assert.equal(result().error, "storage unavailable"); assert.equal(posts.some((post) => post.type === "contextWindowUpdated"), false);
  });
});

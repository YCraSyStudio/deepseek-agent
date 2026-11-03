import { createProviderTranscript } from "@/application/chat/ProviderTranscript";
import { GenerationRunFinalizer } from "@/vscode/webviews/handlers/chat/generation/GenerationRunFinalizer";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";
import { StreamEventEmitter } from "@/vscode/webviews/handlers/chat/streaming/StreamEventEmitter";
import { createUsageAggregate } from "@/shared/usage/Usage";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { ConversationState } from "@/application/chat/ConversationState";
import { DEFAULT_CONFIG } from "@/contracts";
import { writeConversationStorage, readConversationFile } from "@/vscode/storage/ConversationStorage";
import { GenerationCheckpointStore } from "@/vscode/storage/GenerationCheckpointStore";
import { GenerationResultStore } from "@/vscode/webviews/handlers/chat/generation/GenerationResultStore";
import { recoverGenerationCheckpoints } from "@/vscode/webviews/handlers/chat/generation/GenerationRecovery";
import type { HistoryManager } from "@/vscode/storage/HistoryManager";
import type { SettingsRepository } from "@/application/ports";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";

suite("Persisted generation errors", () => {
  let root: string; let previousEnv: string | undefined; let previousDirectory: string | undefined;
  const error = "Error en tool calls: API request failed with HTTP 400. missing file-api-old";
  const settings = { load: () => ({ ...DEFAULT_CONFIG, historyEnabled: true }) } as SettingsRepository;
  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "deepseek-generation-error-"));
    previousEnv = process.env.NODE_ENV; previousDirectory = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
  });
  teardown(async () => {
    if (previousEnv === undefined) {delete process.env.NODE_ENV;} else {process.env.NODE_ENV = previousEnv;}
    if (previousDirectory === undefined) {delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR;} else {process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousDirectory;}
    await rm(root, { recursive: true, force: true });
  });

  for (const completed of [false, true]) {
    test(`recovers a new conversation with queued work and completed=${completed}`, async () => {
      const state = new ConversationState({ save: async () => undefined });
      const user = state.createMessage("user", "Recover this", { generationId: "recover-turn" });
      await state.saveMessages({ messages: [user], model: DEFAULT_CONFIG.model });
      const conversation = state.getConversation()!; const checkpoints = new GenerationCheckpointStore(settings);
      const queue = [{ clientRequestId: "queued", text: "Next task", modelId: DEFAULT_CONFIG.model, reasoning: "off", queuedAt: 1 }];
      const toolCalls = ["pending", "awaiting_confirmation", "running", "completed"].map((status, index) => ({
        toolCallId: `tool-${index}`, toolName: "read_file", arguments: "{}", status: status as "pending" | "awaiting_confirmation" | "running" | "completed",
        requiresConfirmation: true,
      }));
      await checkpoints.save({ conversationId: conversation.id, generationId: "recover-turn", status: completed ? "completed" : "running_tool",
        userMessage: user, content: "Recovered answer", timeline: [], toolCalls: completed ? [] : toolCalls, queue,
        providerTranscript: completed ? createProviderTranscript([{ role: "assistant", content: "Recovered answer", reasoning_content: "Preserved reasoning" }], "complete") : undefined,
        workspaceUri: conversation.workspaceUri, workspaceBinding: conversation.workspaceBinding, updatedAt: 123 });
      const drafts = new Map(); const history = { getById: readConversationFile, save: writeConversationStorage } as HistoryManager;
      await recoverGenerationCheckpoints(checkpoints, history, drafts, settings);
      const stored = await readConversationFile(conversation.id); assert.ok(stored);
      assert.equal(stored.createdAt, 123); assert.equal(stored.messages[0].id, user.id);
      assert.equal(stored.model, DEFAULT_CONFIG.model); assert.deepEqual(drafts.get(conversation.id), queue);
      const assistant = stored.messages.find(message => message.role === "assistant")!;
      assert.equal(assistant.generationStatus, completed ? "completed" : "interrupted");
      if (completed) {
        assert.equal(assistant.providerTranscript?.messages[0].reasoning_content, "Preserved reasoning");
      } else {
        assert.deepEqual(assistant.toolCalls?.map(tool => tool.status), ["cancelled", "cancelled", "cancelled", "completed"]);
        assert.match(assistant.toolCalls![0].result!, /Interrupted because VS Code closed/);
        assert.equal(assistant.toolCalls![0].requiresConfirmation, false);
      }
      assert.deepEqual(await checkpoints.recover(), []);
    });
  }

  for (const persistenceError of [false, true]) {
    test(`disabled history clears recovered drafts and preserves checkpoints only on settings failure=${persistenceError}`, async () => {
      const state = new ConversationState({ save: async () => undefined });
      await state.saveMessages({ messages: [state.createMessage("user", "Queued")], model: DEFAULT_CONFIG.model });
      const conversation = state.getConversation()!; const checkpoints = new GenerationCheckpointStore(settings);
      await checkpoints.save({ conversationId: conversation.id, status: "queued", content: "", timeline: [], toolCalls: [], queue: [],
        workspaceUri: conversation.workspaceUri, workspaceBinding: conversation.workspaceBinding, updatedAt: 1 });
      const disabled = { load: () => ({ ...DEFAULT_CONFIG, historyEnabled: false }),
        getPersistenceError: () => persistenceError ? "settings unavailable" : undefined } as SettingsRepository;
      const drafts = new Map([["chat", []]]);
      await recoverGenerationCheckpoints(checkpoints, {} as HistoryManager, drafts, disabled);
      assert.equal(drafts.size, 0); assert.equal((await checkpoints.recover()).length, persistenceError ? 1 : 0);
    });
  }

  test("recovers queued drafts without creating a conversation when no generation had started", async () => {
    const state = new ConversationState({ save: async () => undefined });
    await state.saveMessages({ messages: [state.createMessage("user", "Queued")], model: DEFAULT_CONFIG.model });
    const conversation = state.getConversation()!; const checkpoints = new GenerationCheckpointStore(settings);
    const queue = [{ clientRequestId: "queued", text: "Next", modelId: DEFAULT_CONFIG.model, reasoning: "off", queuedAt: 1 }];
    await checkpoints.save({ conversationId: conversation.id, status: "queued", content: "", timeline: [], toolCalls: [], queue,
      workspaceUri: conversation.workspaceUri, workspaceBinding: conversation.workspaceBinding, updatedAt: 1 });
    const drafts = new Map();
    await recoverGenerationCheckpoints(checkpoints, {} as HistoryManager, drafts, settings);
    assert.deepEqual(drafts.get(conversation.id), queue); assert.equal(await readConversationFile(conversation.id), undefined);
    assert.deepEqual(await checkpoints.recover(), []);
  });

  for (const partial of [false, true]) {
    test(`retains the exact failure across history reload, with partial output=${partial}`, async () => {
      const state = new ConversationState({ save: writeConversationStorage });
      await state.saveMessages({ messages: [state.createMessage("user", "Continue", { generationId: "failed-turn" })], model: DEFAULT_CONFIG.model });
      const results = new GenerationResultStore({ runs: new Map(), syncSelectedConversation: () => {} });
      await results.save({ content: partial ? "Partial reply" : "", timeline: partial ? [{ id: "reason", type: "reasoning", content: "Inspecting" }] : [],
        state, generationId: "failed-turn", model: DEFAULT_CONFIG.model, status: "error", error });
      const stored = await readConversationFile(state.getActiveConversationId()!); assert.ok(stored);
      const errors = stored.messages.filter(message => message.role === "error");
      assert.equal(errors.length, 1); assert.equal(errors[0].content, error); assert.equal(errors[0].generationId, "failed-turn");
      if (partial) {assert.equal(stored.messages.find(message => message.role === "assistant")?.generationStatus, "error");}
      else {assert.deepEqual(stored.messages.map(message => message.role), ["user", "error"]);}
      const reloaded = new ConversationState({ save: writeConversationStorage }); reloaded.load(stored);
      assert.ok(!JSON.stringify(reloaded.getApiMessages()).includes(error), "UI failures must not become model instructions");
    });
  }

  test("recovers an error checkpoint without restarting generation or duplicating the error", async () => {
    const state = new ConversationState({ save: writeConversationStorage });
    const user = state.createMessage("user", "Continue", { generationId: "failed-turn" });
    await state.saveMessages({ messages: [user], model: DEFAULT_CONFIG.model });
    const conversation = state.getConversation()!;
    const checkpoint = { conversationId: conversation.id, generationId: "failed-turn", status: "error" as const, error, userMessage: user,
      content: "Partial reply", timeline: [], toolCalls: [], queue: [], workspaceUri: conversation.workspaceUri, workspaceBinding: conversation.workspaceBinding, updatedAt: Date.now() };
    const checkpoints = new GenerationCheckpointStore(settings);
    await checkpoints.save(checkpoint);
    const history = { getById: readConversationFile, save: writeConversationStorage } as HistoryManager;
    await recoverGenerationCheckpoints(checkpoints, history, new Map(), settings);
    const stored = await readConversationFile(conversation.id); assert.ok(stored);
    assert.equal(stored.messages.find(message => message.role === "assistant")?.generationStatus, "error");
    assert.equal(stored.messages.filter(message => message.role === "error").length, 1);
    assert.equal(stored.messages.at(-1)?.content, error);
    // A checkpoint left by an interrupted cleanup must not duplicate persisted terminal messages.
    await checkpoints.save(checkpoint);
    await recoverGenerationCheckpoints(checkpoints, history, new Map(), settings);
    assert.deepEqual((await readConversationFile(conversation.id))?.messages, stored.messages);
    assert.deepEqual(await checkpoints.recover(), []);
  });

  test("retains the recovery checkpoint if storing the error in history fails", async () => {
    const state = new ConversationState({ save: async () => {throw new Error("Disk unavailable");} });
    const record = { generationId: "failed", conversationId: "chat", state, status: "streaming", content: "", timeline: [], toolCalls: [], eventLog: [] } as unknown as GenerationRunRecord;
    const runs = new Map([[record.generationId, record]]);
    const results = new GenerationResultStore({ runs, syncSelectedConversation: () => {} });
    await assert.rejects(results.save({ content: "", timeline: [], state, generationId: "failed", model: DEFAULT_CONFIG.model, status: "error", error }), /Disk unavailable/);
    assert.equal(record.errorPersisted, undefined);
    record.status = "error"; record.error = error; record.pendingTerminalEvent = { type: "streamError", error };
    let deleted = 0; let checkpointed = 0;
    const sink = { publish: () => {} };
    const finalizer = new GenerationRunFinalizer({ runs, resultStore: results, checkpoint: async () => {checkpointed++;},
      checkpointStore: { delete: async () => {deleted++;} } as unknown as GenerationCheckpointStore,
      generationEventCallbacks: { scheduleCheckpoint: () => {}, checkpointImmediately: () => {}, postIfSelected: () => {} } });
    await finalizer.finalize({ record, model: DEFAULT_CONFIG.model, eventSink: sink, signal: new AbortController().signal,
      stream: new StreamEventEmitter(sink), usage: createUsageAggregate(false) });
    assert.equal(deleted, 0); assert.equal(checkpointed, 1);
  });

  test("stores the failure even if the model failed before producing any assistant activity", async () => {
    let saved: StoredConversation | undefined;
    const state = new ConversationState({ save: async conversation => {saved = conversation;} });
    const results = new GenerationResultStore({ runs: new Map(), syncSelectedConversation: () => {} });
    await results.save({ content: "", timeline: [], state, generationId: "first-turn", model: DEFAULT_CONFIG.model, status: "error", error });
    assert.deepEqual(saved?.messages.map(message => [message.role, message.content]), [["error", error]]);
  });
});

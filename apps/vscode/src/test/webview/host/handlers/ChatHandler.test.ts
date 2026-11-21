import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { DEFAULT_CONFIG, type AppConfig, type WebviewToHandlerMessage } from "@/contracts";
import type { SettingsRepository } from "@/application/ports";
import { resetVsCodeMock } from "../../../support/VsCodeMock";

suite("chat handler host surface", () => {
  let root: string;
  let previousData: string | undefined;
  let config: AppConfig;
  let settings: SettingsRepository;
  let posts: Array<Record<string, unknown>>;
  let view: vscode.WebviewView;
  let handler: ChatHandler;
  let disposed: number;
  let history: HistoryManager;

  setup(async () => {
    resetVsCodeMock();
    root = await mkdtemp(path.join(tmpdir(), "chat-handler-"));
    previousData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
    config = { ...DEFAULT_CONFIG, historyEnabled: true };
    settings = {
      load: () => config,
      save: async (patch) => { Object.assign(config, patch); },
      reset: async () => { Object.assign(config, DEFAULT_CONFIG); },
      getRevision: () => 1,
      waitForPendingWrites: async () => undefined,
      capturePermissionSnapshot: async () => ({ revision: 1, permissionMode: "default", workspaceTrusted: true, fingerprint: "fixture" }),
      getPersistenceError: () => undefined,
      enterDegradedMode: () => undefined,
    };
    posts = [];
    disposed = 0;
    view = {
      webview: {
        postMessage: async (message: unknown) => { posts.push(message as Record<string, unknown>); return true; },
      },
    } as unknown as vscode.WebviewView;
    history = new HistoryManager(settings);
    handler = new ChatHandler(
      history,
      new ToolRegistry(),
      { dispose: async () => { disposed++; } } as unknown as ConstructorParameters<typeof ChatHandler>[2],
      settings,
      {
        getApiKey: async () => undefined,
        migrateLegacyApiKey: async () => undefined,
        setApiKey: async () => undefined,
        deleteApiKey: async () => undefined,
      },
      { create: () => { throw new Error("No provider in this test"); } },
      async () => undefined,
    );
  });

  teardown(async () => {
    handler.detachWebview(view);
    if (previousData === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; }
    else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousData; }
    resetVsCodeMock();
    await rm(root, { recursive: true, force: true });
  });

  function send(message: Record<string, unknown>) {
    handler.handle(message as unknown as WebviewToHandlerMessage, view);
  }

  function conversation(messages: StoredConversation["messages"] = [{ id: "question", role: "user", content: "Hello" }]): StoredConversation {
    return {
      schemaVersion: 2,
      id: "chat-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 2,
      model: DEFAULT_CONFIG.model,
      workspaceUri: "",
      workspaceBinding: { schemaVersion: 1, uri: "", name: "No workspace", revision: "empty", folders: [], capabilities: { files: false, search: false, git: false, terminal: false } },
      messages,
    };
  }

  test("routes snapshots, running work, tools and cancellation back to the selected webview", async () => {
    handler.attachWebview(view);
    send({ type: "getGenerationSnapshot" });
    assert.ok(posts.some((post) => post.type === "generationSnapshot"));
    send({ type: "getRunningTasks", conversationId: "chat-1" });
    assert.deepEqual(posts.at(-1), { type: "runningTasks", conversationId: "chat-1", tasks: [] });
    send({ type: "getAvailableTools" });
    assert.ok(posts.some((post) => post.type === "availableTools" && Array.isArray(post.tools)));
    send({ type: "cancelGeneration", requestId: "cancel-1", generationId: "missing", conversationId: "chat-1" });
    assert.deepEqual(posts.at(-1), { type: "cancelGenerationResult", requestId: "cancel-1", generationId: "missing", conversationId: "chat-1", status: "stale" });
    send({ type: "executeToolCall", conversationId: "chat-1", generationId: "missing", toolCallId: "call", action: "execute" });
    send({ type: "unknown-host-request" });
    assert.equal(posts.filter((post) => post.type === "cancelGenerationResult").length, 1);
  });
  test("restores a requested saved conversation and scopes an early permission failure to its generation", async () => {
    await history.saveIfAbsent(conversation()); handler.attachWebview(view);
    settings.capturePermissionSnapshot = async () => { throw new Error("Permission snapshot unavailable"); };
    send({ type: "sendMessage", conversationId: "chat-1", clientRequestId: "request", text: "Continue", modelId: config.model, reasoning: "off" });
    for (let i = 0; i < 100 && !posts.some(post => post.type === "streamError"); i++) { await new Promise(resolve => setTimeout(resolve, 2)); }
    const error = posts.find(post => post.type === "streamError"); assert.ok(error);
    assert.equal(error.conversationId, "chat-1"); assert.match(String(error.error), /Permission snapshot unavailable/);
    assert.equal((await handler.getWorkspaceContext("chat-1")).state, "empty");
  });
  test("blocks manual compaction and new messages while a history decision is pending", async () => {
    handler.attachWebview(view); handler.loadConversation(conversation());
    handler.beginHistoryTransition("transition", "enter-incognito");
    send({ type: "compactContext", requestId: "compact", conversationId: "chat-1" });
    send({ type: "sendMessage", clientRequestId: "send", text: "Continue", modelId: config.model, reasoning: "off" });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.match(String(posts.find(post => post.type === "contextCompactionResult" && post.requestId === "compact")?.error), /pending history change/);
    assert.match(String(posts.find(post => post.type === "requestRejected" && post.requestId === "send")?.error), /incognito-mode decision/);
    handler.cancelHistoryTransition("transition");
  });

  test("starts a new conversation and publishes the current workspace context", async () => {
    handler.attachWebview(view);
    send({ type: "newConversation", requestId: "new-1" });
    assert.ok(posts.some((post) => post.type === "newConversationReady" && post.requestId === "new-1"));
    assert.ok(posts.some((post) => post.type === "workspaceContextChanged"));
  });

  test("answers workspace context requests and reports a failed rebind without a workspace", async () => {
    handler.attachWebview(view);
    send({ type: "getWorkspaceContext", requestId: "context-1" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const context = posts.find((post) => post.type === "workspaceContextChanged" && post.requestId === "context-1");
    assert.ok(context);
    assert.equal((context.context as { state: string }).state, "empty");
    send({ type: "rebindConversationWorkspace", conversationId: "missing", workspaceRevision: "empty" });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.ok(posts.some((post) => post.type === "workspaceRebindResult" && post.success === false), JSON.stringify(posts));
  });

  test("reports stopRunningTask failures and forwards manual context compaction", async () => {
    handler.attachWebview(view);
    send({ type: "stopRunningTask", sessionId: "missing", conversationId: "chat-1", requestId: "stop-1" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(posts.some((post) => post.type === "requestRejected" && post.action === "stopRunningTask"), true);
    send({ type: "compactContext", requestId: "compact-1", conversationId: "chat-1" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(posts.some((post) => post.type === "contextCompactionResult" && post.requestId === "compact-1"), true);
  });

  test("consumes recovered drafts one request at a time and clears their persisted queue", async () => {
    handler.attachWebview(view);
    const drafts = (handler as unknown as { recoveredDrafts: Map<string, Array<Record<string, unknown>>> }).recoveredDrafts;
    drafts.set("chat-1", [
      { clientRequestId: "draft-1", text: "First", queuedAt: 1 },
      { clientRequestId: "draft-2", text: "Second", queuedAt: 2 },
    ]);
    send({ type: "consumeRecoveredDraft", conversationId: "chat-1", clientRequestId: "draft-1" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(drafts.get("chat-1")?.map((draft) => draft.clientRequestId), ["draft-2"]);
    send({ type: "consumeRecoveredDraft", conversationId: "chat-1", clientRequestId: "draft-2" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drafts.has("chat-1"), false);
    send({ type: "consumeRecoveredDraft", conversationId: "chat-1", clientRequestId: "absent" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drafts.has("chat-1"), false);
  });

  test("loads persistent conversations, rejects loading when history is disabled and forgets the active one", () => {
    const loaded = handler.loadConversation(conversation());
    assert.ok(loaded);
    assert.equal(loaded!.model.length > 0, true);
    handler.assertWorkspaceIdle();
    handler.registerExternalContextFiles([{ path: "external.ts", type: "file", scope: "external-snapshot", referenceId: "external-1", content: "export {}" }]);
    assert.equal(handler.forgetConversation("chat-1"), true);
    assert.equal(handler.forgetConversation("chat-1"), false);
    config.historyEnabled = false;
    assert.equal(handler.loadConversation(conversation()), undefined);
  });

  test("rebinding without folders and folder changes fail safely", async () => {
    handler.loadConversation(conversation());
    await assert.rejects(handler.rebindConversationWorkspace("chat-1"), /Open at least one workspace folder/);
    await handler.handleWorkspaceFoldersChanged();
    const context = await handler.getWorkspaceContext();
    assert.equal(context.state, "empty");
  });

  test("history transitions can be opened, moved to exit and cancelled by owner", () => {
    assert.deepEqual(handler.beginHistoryTransition("transition-1", "enter-incognito"), { activeGenerations: 0, queuedMessages: 0 });
    assert.equal(handler.beginHistoryTransition("transition-2", "enter-incognito"), undefined);
    handler.setHistoryTransitionPhase("exit-incognito");
    handler.cancelHistoryTransition("transition-2");
    assert.deepEqual(handler.getPendingWorkCounts(), { activeGenerations: 0, queuedMessages: 0 });
    assert.equal(handler.hasIncognitoMessages(), false);
    handler.cancelHistoryTransition("transition-1");
  });

  test("entering, discarding and promoting private work updates the selected view", async () => {
    handler.attachWebview(view);
    handler.loadConversation(conversation());
    await handler.stopPendingWork();
    await handler.enterIncognito("enter-1");
    assert.ok(posts.some((post) => post.type === "clearChat"));
    await handler.promoteIncognito("enter-1");
    handler.discardIncognito("enter-1");
    await handler.discardIncognitoForWebviewRecreation();
    config.historyEnabled = false;
    await handler.discardIncognitoForWebviewRecreation();
    assert.equal(handler.getPendingWorkCounts().activeGenerations, 0);
  });

  test("prepares deletion, detaches only its own view and shuts down owned resources", async () => {
    handler.loadConversation(conversation());
    await handler.prepareConversationDeletion("chat-1");
    handler.attachWebview(view);
    handler.detachWebview(view);
    handler.attachWebview(view);
    const other = { webview: { postMessage: async () => true } } as unknown as vscode.WebviewView;
    handler.detachWebview(other);
    await handler.shutdown();
    assert.equal(disposed, 1);
  });
});

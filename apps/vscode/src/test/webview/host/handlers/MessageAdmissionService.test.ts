import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { MessageAdmissionService } from "@/vscode/webviews/handlers/chat/messaging/MessageAdmissionService";
import { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SettingsRepository } from "@/application/ports";
import type { HistoryManager } from "@/vscode/storage";
import type { ConversationWorkspaceReferences } from "@/vscode/webviews/handlers/chat/session/ConversationWorkspaceReferences";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import { DEFAULT_CONFIG, type WorkspaceBinding, type WorkspaceContextStatus } from "@/contracts";

suite("message admission boundaries", () => {
  const binding: WorkspaceBinding = { schemaVersion: 1, uri: "file:///workspace", name: "Workspace", revision: "rev-1", folders: [], capabilities: { files: true, search: true, git: true, terminal: true } };
  const payload: SendMessagePayload = { clientRequestId: "request", text: "Hello", modelId: "deepseek-flash", reasoning: "off" };
  let state: ConversationState;
  let config: typeof DEFAULT_CONFIG;
  let settings: SettingsRepository;
  let history: HistoryManager;
  let references: ConversationWorkspaceReferences;
  let enqueued: Array<{ conversationId: string; clientRequestId: string; queuedAt: number; payload: SendMessagePayload }>;
  let posts: Array<Record<string, unknown>>;
  let created: string[];
  let loaded: string[];
  let options: {
    shuttingDown: boolean;
    transition: boolean;
    webview: boolean;
    workspace: WorkspaceContextStatus;
    validateError?: Error;
    enqueueError?: Error;
    getById?: StoredConversation;
  };
  let service: MessageAdmissionService;

  setup(() => {
    config = { ...DEFAULT_CONFIG };
    state = new ConversationState({ save: async () => undefined, getWorkspaceBinding: () => binding }, "incognito");
    enqueued = []; posts = []; created = []; loaded = [];
    options = {
      shuttingDown: false, transition: false, webview: true,
      workspace: { binding, state: "connected" },
    };
    settings = {
      load: () => config,
      save: async () => undefined,
      reset: async () => undefined,
      getRevision: () => 1,
      waitForPendingWrites: async () => undefined,
      capturePermissionSnapshot: async () => ({ revision: 1, permissionMode: "default", workspaceTrusted: true, fingerprint: "fixture" }),
      getPersistenceError: () => undefined,
      enterDegradedMode: () => undefined,
    };
    history = {
      getById: async () => options.getById,
      getWorkspaceBinding: () => binding,
    } as unknown as HistoryManager;
    references = {
      getBinding: async () => binding,
      validateFiles: async (files?: unknown[]) => options.validateError ? Promise.reject(options.validateError) : files,
      postContext: (value: WorkspaceBinding) => { posts.push({ type: "workspaceContext", binding: value }); },
    } as unknown as ConversationWorkspaceReferences;
    const coordinator = {
      enqueue: (task: { conversationId: string; clientRequestId: string; queuedAt: number; payload: SendMessagePayload }, front?: boolean) => {
        if (options.enqueueError) { throw options.enqueueError; }
        enqueued.push({ ...task, queuedAt: Number.isFinite(task.queuedAt) ? task.queuedAt : 0, payload: { ...task.payload, front } as SendMessagePayload });
      },
    } as unknown as GenerationCoordinator<SendMessagePayload>;
    service = new MessageAdmissionService({
      conversationState: state,
      coordinator,
      getWebview: () => options.webview ? ({} as vscode.WebviewView) : undefined,
      hasHistoryTransition: () => options.transition,
      historyManager: history,
      isShuttingDown: () => options.shuttingDown,
      loadConversation: (conversation) => { loaded.push(conversation.id); state.load(conversation); },
      resolveWorkspaceContext: () => options.workspace,
      onConversationCreated: (id) => { created.push(id); },
      post: (message) => { posts.push(message); },
      settings,
      workspaceReferences: references,
    });
  });

  test("rejects while shutting down or while a history transition needs a decision", async () => {
    options.shuttingDown = true;
    await service.accept(payload);
    assert.deepEqual(posts, [{ type: "requestRejected", requestId: "request", action: "sendMessage", error: "The extension is shutting down." }]);
    posts = []; options.shuttingDown = false; options.transition = true;
    await service.accept(payload);
    assert.match(String(posts[0].error), /incognito-mode decision/);
    assert.equal(enqueued.length, 0);
  });

  test("waits for settings and ignores a message with no webview", async () => {
    let waited = 0;
    settings.waitForPendingWrites = async () => { waited++; };
    options.webview = false;
    await service.accept(payload);
    assert.equal(waited, 1);
    assert.equal(posts.length, 0);
    assert.equal(enqueued.length, 0);
  });

  test("reports a conversation restoration failure for persistent chats", async () => {
    state.reset("persistent");
    await service.accept({ ...payload, conversationId: "missing" });
    assert.deepEqual(posts, [{ type: "requestRejected", requestId: "request", action: "sendMessage", error: "Conversation not found. Open an existing conversation or start a new chat." }]);
    assert.equal(enqueued.length, 0);
  });

  test("loads an existing persistent conversation before admitting work", async () => {
    state.reset("persistent");
    options.getById = {
      schemaVersion: 2, id: "existing", title: "Existing", createdAt: 1, updatedAt: 1, messages: [],
      model: "deepseek-flash", workspaceUri: binding.uri, workspaceBinding: binding,
    };
    await service.accept({ ...payload, conversationId: "existing" });
    assert.deepEqual(loaded, ["existing"]);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].conversationId, "existing");
  });

  test("creates a new conversation with the default model and reports it to the host", async () => {
    await service.accept({ ...payload, modelId: "" }, true);
    assert.equal(created.length, 1);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].payload.conversationId, created[0]);
    assert.equal((enqueued[0].payload as SendMessagePayload & { front?: boolean }).front, true);
    assert.equal(posts.some((post) => post.type === "workspaceContext"), true);
  });

  test("reuses the active incognito conversation", async () => {
    state.load({
      schemaVersion: 2, id: "active", title: "Active", createdAt: 1, updatedAt: 1, messages: [],
      model: "deepseek-flash", workspaceUri: binding.uri, workspaceBinding: binding,
    });
    await service.accept(payload);
    assert.deepEqual(created, []);
    assert.equal(enqueued[0].conversationId, "active");
  });

  test("rejects disconnected, changed and stale workspace revisions and republishes the binding", async () => {
    for (const workspaceState of ["disconnected", "changed"] as const) {
      posts = [];
      options.workspace = { binding, state: workspaceState };
      await service.accept(payload);
      const rejection = posts.find((post) => post.type === "requestRejected");
      assert.ok(rejection);
      assert.match(String(rejection.error), /workspace/i);
      assert.equal(posts.some((post) => post.type === "workspaceContext"), true);
    }
    posts = []; options.workspace = { binding, state: "connected" };
    await service.accept({ ...payload, workspaceRevision: "old-revision" });
    const stale = posts.find((post) => post.type === "requestRejected");
    assert.ok(stale);
    assert.match(String(stale.error), /workspace changed/i);
    assert.equal(posts.some((post) => post.type === "workspaceContext"), true);
    assert.equal(enqueued.length, 0);
  });

  test("rejects invalid referenced files and enqueue failures with the original message", async () => {
    options.validateError = new Error("Referenced file escapes the workspace");
    await service.accept({ ...payload, referencedFiles: [{ path: "../secret", type: "file" }] });
    assert.deepEqual(posts.find((post) => post.type === "requestRejected"), { type: "requestRejected", requestId: "request", action: "sendMessage", error: "Referenced file escapes the workspace" });
    posts = []; options.validateError = undefined; options.enqueueError = new Error("Queue is full");
    await service.accept(payload);
    assert.equal(posts.find((post) => post.type === "requestRejected")?.error, "Queue is full");
    assert.equal(enqueued.length, 0);
  });
});

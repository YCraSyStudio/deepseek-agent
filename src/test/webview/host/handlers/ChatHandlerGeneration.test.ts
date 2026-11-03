import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { startKeepAliveTerminal } from "@/infrastructure/tools/builtins/terminal/KeepAliveTerminals";
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type ChatCompletionRequest,
  type ImageAttachment,
  type WebviewToHandlerMessage,
} from "@/contracts";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { ModelProvider, SecretStore, SettingsRepository } from "@/application/ports";
import { resetVsCodeMock } from "../../../support/VsCodeMock";

suite("chat handler generation pipeline", () => {
  let root: string;
  let previousData: string | undefined;
  let config: AppConfig;
  let settings: SettingsRepository;
  let posts: Array<Record<string, unknown>>;
  let view: vscode.WebviewView;
  let handler: ChatHandler;
  let history: HistoryManager;
  let requests: ChatCompletionRequest[];
  let archived: string[];
  let hold: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let credential: string | undefined;
  let disposed: number;

  const noop = () => Promise.resolve();
  const readCredential = () => Promise.resolve(credential);

  const provider: ModelProvider = {
    id: "fixture",
    name: "Fixture",
    testConnection: async () => ({ success: true }),
    listModels: async () => [],
    chatCompletion: async () => { throw new Error("Unexpected nonstream request"); },
    chatCompletionStream: async (request, onChunk) => {
      requests.push(request);
      onChunk({ type: "reasoning", reasoning_content: "Thinking" });
      onChunk({ type: "content", content: "Answer" });
      if (hold) { await hold; }
      onChunk({ type: "usage", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      onChunk({ type: "done", finish_reason: "stop" });
    },
  };

  setup(async () => {
    resetVsCodeMock();
    root = await mkdtemp(path.join(tmpdir(), "chat-handler-generation-"));
    previousData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
    config = { ...DEFAULT_CONFIG, historyEnabled: false };
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
    requests = [];
    archived = [];
    hold = undefined;
    release = undefined;
    credential = "fixture-key";
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
        getApiKey: readCredential,
        migrateLegacyApiKey: noop,
        setApiKey: noop,
        deleteApiKey: noop,
      } as unknown as SecretStore,
      { create: () => provider },
      async (conversationId) => { archived.push(conversationId); },
    );
  });

  teardown(async () => {
    releaseHold();
    await handler.shutdown().catch(() => undefined);
    if (previousData === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; }
    else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousData; }
    resetVsCodeMock();
    await rm(root, { recursive: true, force: true });
  });

  function releaseHold() {
    const pending = release;
    hold = undefined;
    release = undefined;
    pending?.();
  }

  function holdStreams() {
    hold = new Promise<void>((resolve) => { release = resolve; });
  }

  function send(message: Record<string, unknown>) {
    handler.handle(message as unknown as WebviewToHandlerMessage, view);
  }

  function activities() {
    return posts.filter((post) => post.type === "generationActivityChanged").map((post) => post.status);
  }

  function acceptedPost(clientRequestId?: string) {
    return posts.find((post) => post.type === "generationAccepted" && (clientRequestId === undefined || post.clientRequestId === clientRequestId));
  }

  function conversationState(): ConversationState {
    return (handler as unknown as { conversationState: ConversationState }).conversationState;
  }

  function coordinator() {
    return (handler as unknown as {
      coordinator: { getActiveGenerations(): unknown[]; getQueuedConversationIds(): string[] };
    }).coordinator;
  }

  async function waitFor(predicate: () => boolean, label: string, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(posts)}`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  function conversation(patch: Partial<StoredConversation> = {}): StoredConversation {
    return {
      schemaVersion: 2,
      id: "chat-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 2,
      workspaceUri: "",
      workspaceBinding: { schemaVersion: 1, uri: "", name: "No workspace", revision: "empty", folders: [], capabilities: { files: false, search: false, git: false, terminal: false } },
      messages: [{ id: "question", role: "user", content: "Hello", createdAt: 1 }],
      ...patch,
    } as unknown as StoredConversation;
  }

  test("streams a submitted message through the coordinator and settles its activity", async () => {
    handler.attachWebview(view);
    send({ type: "sendMessage", text: "Question", clientRequestId: "request-1", modelId: "deepseek-flash", reasoning: "off" });
    await waitFor(() => posts.some((post) => post.type === "streamDone"), "streamDone");
    const accepted = acceptedPost();
    assert.equal(typeof accepted?.generationId, "string");
    assert.equal(typeof accepted?.conversationId, "string");
    assert.equal(posts.filter((post) => post.type === "messageQueued").length, 1);
    assert.deepEqual(activities().slice(0, 2), ["queued", "running"]);
    assert.equal(activities().includes("settled"), true);
    assert.equal(posts.some((post) => post.type === "addMessage" && (post.message as { role?: string }).role === "user"), true);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].thinking, { type: "disabled" });
    assert.equal(posts.find((post) => post.type === "streamDone")?.status, "completed");
    assert.equal(coordinator().getActiveGenerations().length, 0);
  });

  test("persists a generation for an unread conversation, archives images and posts the saved context", async function (this: Mocha.Context) {
    this.timeout(15_000);
    config.historyEnabled = true;
    conversationState().reset("persistent");
    handler.attachWebview(view);
    const withoutModel = handler.loadConversation(conversation());
    assert.ok(withoutModel);
    assert.ok(posts.some((post) => post.type === "workspaceContextChanged"));
    const loaded = handler.loadConversation(conversation({ model: config.model }));
    assert.ok(loaded);
    handler.attachWebview(view);
    const attachment: ImageAttachment = {
      id: "image-1",
      fileId: "file-api-abc",
      name: "screen.png",
      mediaType: "image/png",
      size: 12,
      source: "picker",
      uploadedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      apiBaseUrl: "https://api.deepseek.com",
      cacheFileName: "screen.png",
    };
    send({
      type: "sendMessage",
      text: "Question",
      clientRequestId: "request-2",
      modelId: "",
      reasoning: "high",
      conversationId: "chat-1",
      imageAttachments: [attachment],
    });
    await waitFor(() => posts.some((post) => post.type === "streamDone"), "persistent streamDone");
    assert.deepEqual(archived, ["chat-1"]);
    assert.equal(requests[0].model, config.model);
    assert.deepEqual(requests[0].thinking, { type: "enabled" });
    assert.equal(acceptedPost()?.conversationId, "chat-1");
  });

  test("cancels a running generation and reports it as accepted", async () => {
    handler.attachWebview(view);
    holdStreams();
    send({ type: "sendMessage", text: "Slow question", clientRequestId: "request-3", modelId: "deepseek-flash", reasoning: "off" });
    await waitFor(() => acceptedPost() !== undefined, "generationAccepted");
    const accepted = acceptedPost()!;
    assert.throws(() => handler.assertWorkspaceIdle(), /Wait for active or queued generations/);
    send({
      type: "cancelGeneration",
      requestId: "cancel-1",
      generationId: accepted.generationId,
      conversationId: accepted.conversationId,
    });
    await waitFor(() => posts.some((post) => post.type === "cancelGenerationResult"), "cancelGenerationResult");
    assert.equal(posts.find((post) => post.type === "cancelGenerationResult")?.status, "accepted");
    assert.equal(activities().includes("cancelling"), true);
    releaseHold();
    await waitFor(() => coordinator().getActiveGenerations().length === 0, "cancelled generation to settle");
  });

  test("steering an active generation queues the new prompt and interrupts the original", async () => {
    handler.attachWebview(view);
    holdStreams();
    send({ type: "sendMessage", text: "Original", clientRequestId: "request-4", modelId: "deepseek-flash", reasoning: "off" });
    await waitFor(() => acceptedPost() !== undefined, "generationAccepted");
    const accepted = acceptedPost()!;
    send({
      type: "steerGeneration",
      generationId: accepted.generationId,
      conversationId: accepted.conversationId,
      clientRequestId: "steer-1",
      text: "Steer",
      modelId: "deepseek-flash",
      reasoning: "off",
    });
    await waitFor(() => posts.filter((post) => post.type === "messageQueued").length === 2, "steered prompt to be queued");
    releaseHold();
    await waitFor(
      () => coordinator().getActiveGenerations().length === 0 && coordinator().getQueuedConversationIds().length === 0,
      "steered work to settle",
    );
    assert.equal(posts.filter((post) => post.type === "generationAccepted").length, 2);
    assert.equal(requests.length, 2);
  });

  test("forgetting a conversation with active work cancels and interrupts it", async () => {
    handler.attachWebview(view);
    holdStreams();
    send({ type: "sendMessage", text: "Active", clientRequestId: "request-5", modelId: "deepseek-flash", reasoning: "off" });
    await waitFor(() => acceptedPost() !== undefined, "generationAccepted");
    const conversationId = String(acceptedPost()!.conversationId);
    assert.equal(handler.forgetConversation(conversationId), true);
    releaseHold();
    await waitFor(() => coordinator().getActiveGenerations().length === 0, "forgotten work to settle");
    assert.equal(handler.forgetConversation(conversationId), false);
  });

  test("deleting a conversation with active work waits for it and drops its checkpoint", async () => {
    handler.attachWebview(view);
    holdStreams();
    send({ type: "sendMessage", text: "Deleting", clientRequestId: "request-6", modelId: "deepseek-flash", reasoning: "off" });
    await waitFor(() => acceptedPost() !== undefined, "generationAccepted");
    const conversationId = String(acceptedPost()!.conversationId);
    const deletion = handler.prepareConversationDeletion(conversationId);
    releaseHold();
    await deletion;
    assert.equal(coordinator().getActiveGenerations().length, 0);
  });

  test("shutting down interrupts active runs and closes every owned resource", async () => {
    handler.attachWebview(view);
    holdStreams();
    send({ type: "sendMessage", text: "Shutdown", clientRequestId: "request-7", modelId: "deepseek-flash", reasoning: "off" });
    await waitFor(() => acceptedPost() !== undefined, "generationAccepted");
    const shutdown = handler.shutdown();
    releaseHold();
    await shutdown;
    assert.equal(coordinator().getActiveGenerations().length, 0);
    assert.equal(disposed, 1);
  });

  test("stops a running keep-alive session and opens a stored conversation workspace", async () => {
    handler.attachWebview(view);
    const terminal = startKeepAliveTerminal({
      command: "printf hi",
      environment: { cwd: root, shell: "/bin/sh", workspaceRoot: root },
      conversationId: "chat-1",
    });
    send({ type: "stopRunningTask", sessionId: terminal.sessionId, conversationId: "chat-1", requestId: "stop-1" });
    await waitFor(() => posts.some((post) => post.type === "runningTasks"), "runningTasks");
    assert.equal(posts.some((post) => post.type === "requestRejected"), false);
    send({ type: "openConversationWorkspace", conversationId: "chat-1" });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  });
});

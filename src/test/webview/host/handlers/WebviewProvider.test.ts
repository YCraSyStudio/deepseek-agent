import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG, WEBVIEW_PROTOCOL_VERSION, type AppConfig, type ImageAttachment, type WebviewToHandlerMessage } from "@/contracts";
import type { CompletionService } from "@/vscode/completions/CompletionService";
import type { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { ToolRegistry } from "@/application/tools";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import { WebviewProvider } from "@/vscode/webviews/WebviewProvider";
import { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { WorkspaceRestoreStore } from "@/infrastructure/workspace/WorkspaceRestoreStore";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot } from "@/vscode/workspace";
import { snapshotRoots } from "@/vscode/workspace/WorkspaceChangeTracker";
import { dialogs, hostEvents, hostState, resetVsCodeMock, TabInputTextDiff, Uri, window as vscodeWindow, workspace } from "../../../support/VsCodeMock";

suite("webview provider public protocol behavior", () => {
  let directory: string;
  let env: { mode?: string; data?: string; dev?: string };
  let originalFetch: typeof fetch;
  let providers: WebviewProvider[]; let histories: Map<WebviewProvider, HistoryManager>;
  setup(async () => {
    resetVsCodeMock(); providers = []; histories = new Map(); directory = await mkdtemp(path.join(tmpdir(), "webview-provider-tests-"));
    env = { mode: process.env.NODE_ENV, data: process.env.DEEPSEEK_AGENT_USER_DATA_DIR, dev: process.env.DEEPSEEK_AGENT_WEBVIEW_DEV_SERVER };
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(directory, "data"); delete process.env.DEEPSEEK_AGENT_WEBVIEW_DEV_SERVER;
    originalFetch = globalThis.fetch;
    await mkdir(path.join(directory, "dist", "webview"), { recursive: true });
    await writeFile(path.join(directory, "dist", "webview", "index.html"), '<meta content="{{CSP_SOURCE}} {{NONCE}}"><script src="./assets/main.js"></script><link href="assets/main.css">');
  });
  teardown(async () => {
    for (const provider of providers) { await provider.shutdown(); }
    resetVsCodeMock(); globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ NODE_ENV: env.mode, DEEPSEEK_AGENT_USER_DATA_DIR: env.data, DEEPSEEK_AGENT_WEBVIEW_DEV_SERVER: env.dev })) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
    await rm(directory, { recursive: true, force: true });
  });
  function provider(patch: Partial<AppConfig> = {}, apiKey?: string) {
    const config = { ...DEFAULT_CONFIG, historyEnabled: false, ...patch };
    const settings = { load: () => config, getRevision: () => 1, waitForPendingWrites: async () => undefined,
      getPersistenceError: () => undefined, enterDegradedMode: () => undefined,
      capturePermissionSnapshot: async (workspaceTrusted: boolean) => ({ revision: 1, permissionMode: config.permissionMode, workspaceTrusted, fingerprint: "fixture" }),
      save: async (patch: Partial<AppConfig>) => { Object.assign(config, patch); }, reset: async () => { Object.assign(config, DEFAULT_CONFIG); },
    } as SettingsRepository;
    const history = new HistoryManager(settings);
    const instance = new WebviewProvider(Uri.file(directory) as vscode.Uri, { globalStorageUri: Uri.file(path.join(directory, "global")), globalState: { get: () => undefined } } as unknown as vscode.ExtensionContext,
      { historyManager: history, toolRegistry: new ToolRegistry(), headlessWebRuntime: { dispose: async () => undefined } as unknown as HeadlessWebRuntime,
        settings, secrets: { getApiKey: async () => apiKey, migrateLegacyApiKey: async () => undefined } as unknown as SecretStore,
        modelProviderFactory: {} as ModelProviderFactory, completions: { suggest: async () => "suggested continuation" } as unknown as CompletionService });
    providers.push(instance); histories.set(instance, history); return instance;
  }

  test("loads image previews and permanently deletes the selected conversation and its uploaded images", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const deleted: string[] = [];
    globalThis.fetch = async (url, init) => {
      if (init?.method === "DELETE") { deleted.push(String(url)); return new Response(null, { status: 204 }); }
      return Response.json({ id: "file-api-history-image", bytes: bytes.length, created_at: 100, filename: "image.png" });
    };
    const instance = provider({ historyEnabled: true }, "test-key"); const view = mockView();
    await instance.resolveWebviewView(view.view); await view.handshake();
    view.receive({ type: "uploadClipboardImage", requestId: "image", name: "image.png", mediaType: "image/png", size: bytes.length, dataBase64: bytes.toString("base64") });
    await view.wait("imageAttachmentsSelected"); const attachment = (view.last("imageAttachmentsSelected").attachments as ImageAttachment[])[0];
    const binding = captureCurrentWorkspaceBinding();
    await histories.get(instance)!.save({ schemaVersion: 2, id: "with-image", title: "Image chat", createdAt: 1, updatedAt: 1, model: DEFAULT_CONFIG.model,
      workspaceUri: binding.uri, workspaceBinding: binding, messages: [{ id: "u", role: "user", content: "Image", imageAttachments: [attachment] }, { id: "a", role: "assistant", content: "Answer" }] });
    view.receive({ type: "loadConversation", requestId: "load", id: "with-image" }); await view.wait("conversationLoaded");
    assert.equal(view.last("conversationLoaded").requestId, "load");
    dialogs.warning = "Delete"; view.receive({ type: "deleteConversation", id: "with-image" });
    await view.wait("conversationDeleted"); await view.wait("clearChat");
    for (let i = 0; i < 100 && !deleted.length; i++) { await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.equal(deleted.length, 1); assert.match(deleted[0], /file-api-history-image/);
    assert.equal(await histories.get(instance)!.getById("with-image"), undefined);
  });
  test("deleting an unselected conversation preserves the active chat", async () => {
    const instance = provider({ historyEnabled: true }); const view = mockView(); await instance.resolveWebviewView(view.view); await view.handshake();
    const binding = captureCurrentWorkspaceBinding();
    await histories.get(instance)!.save({ schemaVersion: 2, id: "unselected", title: "Unselected", createdAt: 1, updatedAt: 1, model: DEFAULT_CONFIG.model,
      workspaceUri: binding.uri, workspaceBinding: binding, messages: [{ id: "u", role: "user", content: "Saved" }] });
    dialogs.warning = "Delete"; view.receive({ type: "deleteConversation", id: "unselected" }); await view.wait("conversationDeleted"); await tick();
    assert.equal(view.posts.some(post => post.type === "clearChat"), false);
  });
  test("routes attachment selection and workspace-folder changes through the attached view", async () => {
    const instance = provider(); const view = mockView(); await instance.resolveWebviewView(view.view); await view.handshake();
    hostState.selectedFolders = undefined;
    view.receive({ type: "selectAttachments", requestId: "cancel" }); await tick();
    assert.equal(view.posts.some(post => post.type === "imageAttachmentsSelected"), false);
    const file = path.join(directory, "attachment.txt"); await writeFile(file, "Selected context"); hostState.selectedFolders = [Uri.file(file)];
    view.receive({ type: "selectAttachments", requestId: "picker" }); await view.wait("imageAttachmentsSelected"); await view.wait("contextFilesSelected");
    assert.equal(view.last("imageAttachmentsSelected").requestId, "picker"); assert.deepEqual(view.last("imageAttachmentsSelected").attachments, []);
    assert.equal((view.last("contextFilesSelected").files as unknown[]).length, 1);
    hostEvents.folders.fire(); await view.wait("workspaceContextChanged");
  });

  test("queues draft/context commands until a view attaches, then flushes them in order", async () => {
    const instance = provider(); await instance.addReferencedFiles([]);
    await instance.setDraft("Pending draft"); await instance.addReferencedFiles([{ path: "file.ts", name: "file.ts", type: "file", content: "contents", scope: "external-snapshot" }]);
    const view = mockView(); await instance.resolveWebviewView(view.view);
    assert.deepEqual(view.posts.filter((post) => post.type === "setDraft" || post.type === "addReferencedFiles").map((post) => post.type), ["setDraft", "addReferencedFiles"]);
    assert.equal(view.last("setDraft").text, "Pending draft");
    await instance.setDraft("Immediate draft"); assert.equal(view.last("setDraft").text, "Immediate draft");
    assert.match(view.view.webview.html, /nonce=/); assert.ok(!view.view.webview.html.includes("{{NONCE}}"));
    assert.equal(view.view.webview.options.enableScripts, true);
  });

  test("bounds both the pending message count and total retained bytes", async () => {
    const instance = provider();
    for (let index = 0; index < 128; index++) { await instance.setDraft(String(index)); }
    await assert.rejects(() => instance.setDraft("overflow"), /queue resource limit/);
    const large = provider(); await assert.rejects(() => large.setDraft("x".repeat(8 * 1024 * 1024)), /queue resource limit/);
  });

  test("requires the versioned handshake and rejects malformed payloads before dispatch", async () => {
    const instance = provider(); const view = mockView(); await instance.resolveWebviewView(view.view);
    view.receive({ type: "getConfig" }); await view.wait("requestRejected");
    assert.match(view.last("requestRejected").error as string, /not been initialized/);
    view.receive({ type: "initializeProtocol", protocolVersion: WEBVIEW_PROTOCOL_VERSION + 1 }); await view.wait("requestRejected", 2);
    view.receive({ type: "initializeProtocol", protocolVersion: WEBVIEW_PROTOCOL_VERSION }); await view.wait("protocolReady");
    view.receive({ type: "copyCode", code: 42, requestId: "invalid" }); await view.wait("requestRejected", 3);
    assert.equal(view.last("requestRejected").requestId, "invalid");
    view.receive({ type: "copyCode", code: "const answer = 42;" }); await tick(); assert.deepEqual(hostState.copied, ["const answer = 42;"]);
    view.receive({ type: "selectModel", modelId: "deepseek-flash" }); await view.wait("modelChanged"); assert.equal(view.last("modelChanged").modelId, "deepseek-flash");
  });

  test("routes host configuration, history, suggestions and task snapshots through the real handlers", async () => {
    const instance = provider(); const view = mockView(); await instance.initialize(); await instance.resolveWebviewView(view.view);
    await view.handshake();
    view.receive({ type: "getConfig" }); await view.wait("configLoaded"); assert.equal(view.last("apiKeyStatus").status, "missing");
    view.receive({ type: "getHistory" }); await view.wait("history"); assert.deepEqual(view.last("history").conversations, []);
    view.receive({ type: "getAvailableTools" }); await view.wait("availableTools"); assert.deepEqual(view.last("availableTools").tools, []);
    view.receive({ type: "getGenerationSnapshot" }); await view.wait("generationSnapshot");
    view.receive({ type: "getRunningTasks" }); await view.wait("runningTasks"); assert.deepEqual(view.last("runningTasks").tasks, []);
    view.receive({ type: "getChatSuggestion", requestId: "suggest", prefix: "Continue" }); await view.wait("chatSuggestion"); assert.equal(view.last("chatSuggestion").text, "suggested continuation");
    view.receive({ type: "cancelChatSuggestion", requestId: "suggest" });
  });

  test("new-chat commands reveal the view and clear the previous composer", async () => {
    const instance = provider(); await instance.startNewChat();
    const view = mockView(); await instance.initialize(); await instance.resolveWebviewView(view.view); await instance.startNewChat();
    await view.wait("clearChat"); assert.equal(view.last("setDraft").text, "");
  });

  test("recreating a view drops its old protocol and disposes its registrations", async () => {
    const instance = provider(); const first = mockView(); await instance.resolveWebviewView(first.view); await first.handshake();
    const second = mockView(); await instance.resolveWebviewView(second.view);
    first.receive({ type: "copyCode", code: "ignored" }); await tick(); assert.deepEqual(hostState.copied, []);
    second.receive({ type: "copyCode", code: "not ready" }); await second.wait("requestRejected"); await second.handshake();
    first.dispose(); await instance.setDraft("Second view remains attached"); assert.equal(second.last("setDraft").text, "Second view remains attached");
    second.dispose(); await instance.setDraft("Queued after disposal");
    const third = mockView(); await instance.resolveWebviewView(third.view); assert.equal(third.last("setDraft").text, "Queued after disposal");
  });

  for (const outcome of ["available", "http-failure", "network-failure"] as const) {
    test(`development server probing selects the correct HTML, outcome=${outcome}`, async () => {
      process.env.DEEPSEEK_AGENT_WEBVIEW_DEV_SERVER = "http://localhost:5175";
      globalThis.fetch = (async () => { if (outcome === "network-failure") { throw new Error("offline"); } return new Response("", { status: outcome === "available" ? 200 : 503 }); }) as typeof fetch;
      const instance = provider(); const view = mockView(); await instance.resolveWebviewView(view.view);
      assert.equal(view.view.webview.html.includes("@vite/client"), outcome === "available");
      assert.equal(view.view.webview.options.localResourceRoots!.length, 4);
    });
  }

  test("paths and editor writes are rejected when the requested workspace revision is unavailable", async () => {
    const instance = provider(); const view = mockView(); await instance.resolveWebviewView(view.view); await view.handshake();
    view.receive({ type: "getPathCompletions", requestId: 1, query: "src", workspaceRevision: "stale" }); await view.wait("pathCompletions");
    assert.deepEqual(view.last("pathCompletions").items, []);
    view.receive({ type: "insertCode", code: "replacement", workspaceRevision: "stale" }); await tick();
    view.receive({ type: "openFile", path: "file.ts", workspaceRevision: "stale" }); await tick();
    view.receive({ type: "openFileDiff", path: "file.ts", workspaceRevision: "stale" }); await tick();
    assert.equal(hostState.opened.length, 0);
  });

  async function savedTurn() {
    const project = path.join(directory, "workspace"); await mkdir(project); const file = path.join(project, "file.ts"); await writeFile(file, "before\n");
    workspace.workspaceFolders = [{ name: "Project", uri: Uri.file(project) }]; const binding = captureCurrentWorkspaceBinding(); const roots = snapshotRoots(captureWorkspaceRunSnapshot(binding));
    const instance = provider({ historyEnabled: true });
    await histories.get(instance)!.save({ schemaVersion: 2, id: "chat", title: "Recovery", createdAt: 1, updatedAt: 1, model: DEFAULT_CONFIG.model, workspaceUri: binding.uri, workspaceBinding: binding,
      messages: [{ id: "user", role: "user", content: "Edit file", generationId: "turn" }, { id: "answer", role: "assistant", content: "Edited", generationId: "turn", generationStatus: "completed" }] });
    const store = new WorkspaceRestoreStore("chat"); await store.begin("turn", roots, new Map()); await writeFile(file, "after\n"); await store.finish("turn", roots, new Map());
    const changed = (await store.review(roots, "turn")).paths[0]; const view = mockView(); await instance.resolveWebviewView(view.view); await view.handshake();
    return { instance, view, file, changed, store, roots };
  }
  test("opens a protocol diff and reverts its saved turn through the native review action", async () => {
    const { view, file } = await savedTurn(); const revision = captureCurrentWorkspaceBinding().revision;
    view.receive({ type: "openFileDiff", path: "./file.ts", conversationId: "chat", generationId: "turn", workspaceRevision: revision,
      diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-before\n+after", preview: false });
    for (let i = 0; i < 100 && !hostState.commandCalls.some(call => call.command === "vscode.diff"); i++) { await new Promise(resolve => setTimeout(resolve, 2)); }
    const opened = hostState.commandCalls.find(call => call.command === "vscode.diff"); assert.ok(opened, JSON.stringify({ errors: dialogs.errors, posts: view.posts }));
    assert.deepEqual(opened.args[3], { preview: false });
    const [before, after] = opened.args as vscode.Uri[];
    const documents = hostState.textProviders.get("ycrasy-change") as { provideTextDocumentContent(uri: vscode.Uri): string };
    assert.match(documents.provideTextDocumentContent(before), /before/); assert.match(documents.provideTextDocumentContent(after), /after/);
    vscodeWindow.tabGroups.activeTabGroup.activeTab = { input: new TabInputTextDiff(before as never, after as never) };
    await hostState.commandHandlers.get("deepseek-agent.revertReviewedTurn")!();
    assert.equal(await readFile(file, "utf8"), "before\n");
    assert.ok(view.posts.some(post => post.type === "workspaceTurn" && post.requestId === "native-review" && post.reverted === true));
  });

  test("reviews a saved turn and opens only a file belonging to that turn", async () => {
    const { view, changed } = await savedTurn(); let diffArguments: unknown[] = [];
    hostState.commandHandlers.set("vscode.diff", (...args) => { diffArguments = args; });
    view.receive({ type: "getWorkspaceTurn", requestId: "review", conversationId: "chat", generationId: "turn" }); await view.wait("workspaceTurn");
    assert.deepEqual(view.last("workspaceTurn").paths, [changed]); assert.equal(view.last("workspaceTurn").error, undefined);
    view.receive({ type: "reviewWorkspaceTurn", requestId: "open", conversationId: "chat", generationId: "turn", path: changed }); await view.wait("workspaceTurn", 2);
    assert.ok(hostState.executed.includes("vscode.diff")); assert.equal(view.last("workspaceTurn").requestId, "open");
    const documentProvider = hostState.textProviders.get("ycrasy-change") as { provideTextDocumentContent(uri: vscode.Uri): string };
    assert.equal(documentProvider.provideTextDocumentContent(diffArguments[0] as vscode.Uri), "before\n");
    assert.equal(documentProvider.provideTextDocumentContent(diffArguments[1] as vscode.Uri), "after\n");
    const opened = hostState.executed.length;
    view.receive({ type: "reviewWorkspaceTurn", requestId: "outside", conversationId: "chat", generationId: "turn", path: "outside.ts" }); await view.wait("workspaceTurn", 3);
    assert.match(view.last("workspaceTurn").error as string, /not part of the selected turn/); assert.equal(hostState.executed.length, opened);
  });
  test("review picker cancellation preserves the turn and selection opens its saved diff", async () => {
    const { view, changed, file } = await savedTurn();
    view.receive({ type: "reviewWorkspaceTurn", requestId: "cancel", conversationId: "chat", generationId: "turn" }); await view.wait("workspaceTurn");
    assert.equal(view.last("workspaceTurn").error, undefined); assert.equal(hostState.executed.includes("vscode.diff"), false); assert.equal(await readFile(file, "utf8"), "after\n");
    hostState.quickPick = changed; view.receive({ type: "reviewWorkspaceTurn", requestId: "pick", conversationId: "chat", generationId: "turn" }); await view.wait("workspaceTurn", 2); assert.ok(hostState.executed.includes("vscode.diff"));
  });
  test("connected workspace paths support completions and native file opening", async () => {
    const { view, file } = await savedTurn(); const revision = captureCurrentWorkspaceBinding().revision;
    view.receive({ type: "getPathCompletions", requestId: 123, conversationId: "chat", workspaceRevision: revision, query: "./f" }); await view.wait("pathCompletions");
    assert.ok((view.last("pathCompletions").items as Array<{ path: string }>).some((item) => item.path === "./file.ts")); assert.equal(view.last("pathCompletions").workspaceRevision, revision);
    view.receive({ type: "openFile", conversationId: "chat", workspaceRevision: revision, path: "./file.ts" });
    for (let attempts = 0; attempts < 50 && !hostState.opened.length; attempts++) { await new Promise((resolve) => setTimeout(resolve, 2)); }
    assert.equal(hostState.opened[0].fsPath, file);
    view.receive({ type: "insertCode", conversationId: "chat", workspaceRevision: revision, code: "replacement" }); await tick(); assert.equal(await readFile(file, "utf8"), "after\n");
  });

  test("reverts a saved turn through the protocol and reports both native and correlated review state", async () => {
    const { view, file } = await savedTurn(); view.receive({ type: "revertWorkspaceTurn", requestId: "revert", conversationId: "chat", generationId: "turn" }); await view.wait("workspaceTurn", 2);
    assert.equal(await readFile(file, "utf8"), "before\n"); assert.equal(view.last("workspaceTurn").requestId, "revert"); assert.equal(view.last("workspaceTurn").reverted, true);
    assert.ok(view.posts.some((post) => post.type === "workspaceTurn" && post.requestId === "native-review" && post.reverted === true));
  });
  test("recovery refuses a disconnected workspace and preserves the changed file", async () => {
    const { view, file } = await savedTurn(); workspace.workspaceFolders = [];
    view.receive({ type: "revertWorkspaceTurn", requestId: "disconnected", conversationId: "chat", generationId: "turn" }); await view.wait("workspaceTurn");
    assert.match(view.last("workspaceTurn").error as string, /Reconnect the original workspace/); assert.equal(await readFile(file, "utf8"), "after\n");
  });
  test("saved screenshots produce correlated previews and open through the native command", async () => {
    const { view } = await savedTurn(); const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const capture = await new ScreenshotStore("chat").save(bytes, { kind: "screen", target: "screen" });
    view.receive({ type: "getScreenshotPreview", requestId: "preview", conversationId: "chat", screenshotId: capture.id }); await view.wait("screenshotPreview");
    assert.equal(view.last("screenshotPreview").requestId, "preview"); assert.equal(view.last("screenshotPreview").uri, Uri.file(path.join(new ScreenshotStore("chat").directory, capture.fileName)).toString()); const metadata = view.last("screenshotPreview").metadata as Record<string, unknown>;
    assert.deepEqual({ ...metadata, accessedAt: 0 }, { ...JSON.parse(JSON.stringify(capture)), accessedAt: 0 }); assert.ok((metadata.accessedAt as number) >= capture.accessedAt);
    view.receive({ type: "openScreenshot", requestId: "open", conversationId: "chat", screenshotId: capture.id });
    for (let attempts = 0; attempts < 50 && !hostState.executed.includes("vscode.open"); attempts++) { await new Promise((resolve) => setTimeout(resolve, 2)); }
    assert.ok(hostState.executed.includes("vscode.open"));
    view.receive({ type: "getScreenshotPreview", requestId: "gone", conversationId: "chat", screenshotId: "screenshot-999" }); await view.wait("screenshotPreview", 2); assert.match(view.last("screenshotPreview").error as string, /deleted or is unavailable/);
  });
  test("clipboard upload and deletion return correlated success and credential failures", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    globalThis.fetch = async () => Response.json({ id: "file-api-upload", bytes: bytes.length, created_at: 100, filename: "image.png" });
    const instance = provider({}, "test-key"); const view = mockView(); await instance.resolveWebviewView(view.view); await view.handshake();
    view.receive({ type: "uploadClipboardImage", requestId: "upload", name: "image.png", mediaType: "image/png", size: bytes.length, dataBase64: bytes.toString("base64") }); await view.wait("imageAttachmentsSelected");
    const attachments = view.last("imageAttachmentsSelected").attachments as Array<Record<string, unknown>>; assert.equal(attachments.length, 1); assert.equal(view.last("imageAttachmentsSelected").requestId, "upload");
    view.receive({ type: "deleteImageAttachment", requestId: "delete", attachment: attachments[0] }); await view.wait("imageAttachmentDeleted"); assert.equal(view.last("imageAttachmentDeleted").success, true);
    const noKey = provider(); const other = mockView(); await noKey.resolveWebviewView(other.view); await other.handshake();
    other.receive({ type: "uploadClipboardImage", requestId: "missing-key", name: "image.png", mediaType: "image/png", size: bytes.length, dataBase64: bytes.toString("base64") }); await other.wait("imageAttachmentsSelected"); assert.ok(other.last("imageAttachmentsSelected").error);
    other.receive({ type: "deleteImageAttachment", requestId: "missing-delete-key", attachment: attachments[0] }); await other.wait("imageAttachmentDeleted"); assert.equal(other.last("imageAttachmentDeleted").success, false); assert.equal(other.last("imageAttachmentDeleted").requestId, "missing-delete-key");
  });

  test("missing turns and screenshots produce correlated errors instead of unhandled rejections", async () => {
    const instance = provider(); const view = mockView(); await instance.resolveWebviewView(view.view); await view.handshake();
    for (const type of ["getWorkspaceTurn", "reviewWorkspaceTurn", "revertWorkspaceTurn"] as const) {
      view.receive({ type, requestId: type, conversationId: "missing", generationId: "turn-1" });
      await view.wait("workspaceTurn", type === "getWorkspaceTurn" ? 1 : type === "reviewWorkspaceTurn" ? 2 : 3);
      assert.equal(view.last("workspaceTurn").requestId, type); assert.ok(view.last("workspaceTurn").error);
    }
    view.receive({ type: "getScreenshotPreview", requestId: "capture", conversationId: "missing", screenshotId: "screenshot-1" }); await view.wait("screenshotPreview");
    assert.equal(view.last("screenshotPreview").requestId, "capture"); assert.match(view.last("screenshotPreview").error as string, /unavailable/i);
  });
});

async function tick() { for (let i = 0; i < 8; i++) { await new Promise<void>((resolve) => setImmediate(resolve)); } }
function mockView() {
  const posts: Array<Record<string, unknown>> = [];
  const receives = new Set<(message: unknown) => void>(); const disposals = new Set<() => void>(); const visibility = new Set<() => void>();
  const view = { visible: true,
    webview: { html: "", options: {}, cspSource: "vscode-resource:", asWebviewUri: (uri: unknown) => uri,
      postMessage: async (post: Record<string, unknown>) => { posts.push(post); return true; },
      onDidReceiveMessage: (listener: (message: unknown) => void) => { receives.add(listener); return { dispose: () => { receives.delete(listener); } }; } },
    onDidDispose: (listener: () => void) => { disposals.add(listener); return { dispose: () => { disposals.delete(listener); } }; },
    onDidChangeVisibility: (listener: () => void) => { visibility.add(listener); return { dispose: () => { visibility.delete(listener); } }; },
  } as unknown as vscode.WebviewView;
  const wait = async (type: string, count = 1) => {
    const end = Date.now() + 2000;
    while (posts.filter((post) => post.type === type).length < count) {
      if (Date.now() > end) { assert.fail(`Missing ${type}: ${JSON.stringify(posts)}`); }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  const receive = (message: unknown) => { for (const listener of receives) { listener(message); } };
  return { view, posts, receive, wait,
    dispose() { for (const listener of [...disposals]) { listener(); } },
    async handshake() { receive({ type: "initializeProtocol", protocolVersion: WEBVIEW_PROTOCOL_VERSION } satisfies WebviewToHandlerMessage); await wait("protocolReady"); },
    last(type: string) { const result = [...posts].reverse().find((post) => post.type === type); assert.ok(result, `Missing ${type}`); return result; },
  };
}

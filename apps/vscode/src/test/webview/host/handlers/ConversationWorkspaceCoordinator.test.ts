import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ConversationWorkspaceCoordinator } from "@/vscode/webviews/handlers/chat/session/ConversationWorkspaceCoordinator";
import { ConversationWorkspaceReferences } from "@/vscode/webviews/handlers/chat/session/ConversationWorkspaceReferences";
import { ConversationState } from "@/application/chat/ConversationState";
import { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import type { SettingsRepository } from "@/application/ports";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import { DEFAULT_CONFIG, type QueuedGenerationMessage } from "@/contracts";
import { dialogs, hostState, resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("conversation workspace coordination public workflow", () => {
  let root: string; let oldMode: string | undefined; let oldData: string | undefined;
  let state: ConversationState; let history: HistoryManager; let generations: GenerationCoordinator<SendMessagePayload>; let service: ConversationWorkspaceCoordinator;
  let posts: Array<Record<string, unknown>>; let snapshots: number; let deleted: string[]; let recovered: Map<string, QueuedGenerationMessage[]>; let conversation: StoredConversation;
  let interrupted: string[];
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "conversation-workspace-")); oldMode = process.env.NODE_ENV; oldData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(root, "data"); await folder("original");
    history = new HistoryManager({ load: () => ({ ...DEFAULT_CONFIG, historyEnabled: true }) } as SettingsRepository); state = new ConversationState(history);
    const binding = captureCurrentWorkspaceBinding(); conversation = { schemaVersion: 2, id: "chat", title: "Chat", createdAt: 1, updatedAt: 1, model: DEFAULT_CONFIG.model, workspaceUri: binding.uri, workspaceBinding: binding, messages: [] };
    await history.save(conversation); state.load(conversation); posts = []; snapshots = 0; deleted = []; recovered = new Map(); interrupted = []; let next = 0;
    generations = new GenerationCoordinator({ idGenerator: { next: () => `generation-${++next}` }, getLimit: () => 1, run: async (_id, task, signal) => new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => { interrupted.push(task.conversationId); resolve(); }, { once: true });
    }) });
    service = new ConversationWorkspaceCoordinator({ checkpointStore: { delete: async (id: string) => { deleted.push(id); } } as ConstructorParameters<typeof ConversationWorkspaceCoordinator>[0]["checkpointStore"],
      conversationState: state, coordinator: generations, historyManager: history, post: (post) => { posts.push(post); }, postGenerationSnapshot: () => { snapshots++; }, recoveredDrafts: recovered, runs: new Map(),
      workspaceReferences: new ConversationWorkspaceReferences({ conversationState: state, historyManager: history, post: (post) => { posts.push(post); } }) });
  });
  teardown(async () => {
    await generations.shutdown(); resetVsCodeMock(); for (const [name, value] of [["NODE_ENV", oldMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", oldData]]) { if (value === undefined) { delete process.env[name!]; } else { process.env[name!] = value; } }
    await rm(root, { recursive: true, force: true });
  });
  async function folder(name: string) { const directory = path.join(root, name); await mkdir(directory, { recursive: true }); workspace.workspaceFolders = [{ uri: Uri.file(directory), name }]; }
  function enqueue(id: string, text = id, conversationId = "chat") { generations.enqueue({ conversationId, clientRequestId: id, queuedAt: 10, payload: { clientRequestId: id, text, modelId: DEFAULT_CONFIG.model, reasoning: "off" } }); }
  function rebindResult() { const found = posts.find((post) => post.type === "workspaceRebindResult"); assert.ok(found); return found; }
  test("reports the stored conversation's workspace context rather than silently replacing it", async () => {
    assert.equal((await service.getContext("chat")).state, "connected"); await folder("different"); const context = await service.getContext("chat"); assert.equal(context.state, "disconnected"); assert.equal(context.binding.uri, conversation.workspaceBinding.uri);
  });
  test("rebind updates the selected conversation, persistent history and checkpoint", async () => {
    await folder("new-project"); const current = captureCurrentWorkspaceBinding(); const context = await service.rebind("chat");
    assert.equal(context.state, "connected"); assert.equal(state.getConversation()?.workspaceBinding.uri, current.uri); const saved = await history.getById("chat");
    assert.equal(saved?.workspaceBinding.revision, current.revision); assert.equal(saved?.workspaceRebindings?.at(-1)?.fromWorkspaceUri, conversation.workspaceBinding.uri); assert.equal(saved?.workspaceRebindings?.at(-1)?.toWorkspaceUri, current.uri); assert.deepEqual(deleted, ["chat"]); assert.ok(posts.some((post) => post.type === "workspaceContextChanged"));
  });
  test("rebind does not replace another selected conversation and bounds audit history", async () => {
    const prior = Array.from({ length: 100 }, (_, at) => ({ fromWorkspaceUri: `old-${at}`, toWorkspaceUri: `new-${at}`, at })); await history.save({ ...(await history.getById("chat"))!, workspaceRebindings: prior, updatedAt: 2 });
    state.load({ ...conversation, id: "other" }); await folder("new-project"); await service.rebind("chat");
    assert.equal(state.getActiveConversationId(), "other"); const rebound = await history.getById("chat"); assert.equal(rebound?.workspaceRebindings?.length, 100); assert.equal(rebound?.workspaceRebindings?.[0].fromWorkspaceUri, "old-1");
  });
  test("rebind recovers queued text and waits for the interrupted generation", async () => {
    enqueue("active"); enqueue("queued", "Keep this draft"); await folder("new-project"); await service.rebind("chat");
    assert.deepEqual(interrupted, ["chat"]); assert.equal(generations.getActiveForConversation("chat"), undefined); assert.deepEqual(recovered.get("chat"), [{ clientRequestId: "queued", text: "Keep this draft", queuedAt: 10 }]); assert.equal(generations.getQueue("chat").length, 0);
  });
  test("refuses empty workspaces and unknown conversations without deleting checkpoints", async () => {
    workspace.workspaceFolders = []; await assert.rejects(service.rebind("chat"), /Open at least one workspace folder/); await folder("new-project"); await assert.rejects(service.rebind("missing"), /Conversation not found/); assert.deepEqual(deleted, []);
  });
  test("stale rebind revisions fail without altering the saved binding", async () => {
    await folder("new-project"); await service.confirmAndRebind("chat", "stale"); assert.equal(rebindResult().success, false); assert.match(rebindResult().error as string, /binding changed/); assert.equal(snapshots, 0); assert.equal((await history.getById("chat"))?.workspaceBinding.uri, conversation.workspaceBinding.uri);
  });
  test("confirmed rebind publishes its context and a generation snapshot", async () => {
    await folder("new-project"); await service.confirmAndRebind("chat", conversation.workspaceBinding.revision); assert.equal(rebindResult().success, true); assert.equal(snapshots, 1);
  });
  test("failed confirmation returns a protocol error instead of rejecting", async () => {
    await service.confirmAndRebind("missing"); assert.equal(rebindResult().success, false); assert.match(rebindResult().error as string, /Conversation not found/); assert.equal(snapshots, 0);
  });
  test("opening a saved workspace invokes native openFolder while unsaved logical workspaces show guidance", async () => {
    await service.open("chat"); assert.ok(hostState.executed.includes("vscode.openFolder"));
    state.load({ ...conversation, workspaceBinding: { ...conversation.workspaceBinding, uri: "ycrasy-workspace:unsaved", name: "Multiple folders" } });
    const count = hostState.executed.length; await service.open("chat"); assert.equal(hostState.executed.length, count); assert.match(String(dialogs.informationMessages.at(-1)?.[0]), /Multiple folders.*manually|manually.*Multiple folders/);
  });
  test("folder changes interrupt disconnected generations and recover queued drafts", async () => {
    enqueue("active"); enqueue("queued", "Restore after workspace change"); await folder("different"); await service.handleFoldersChanged("chat");
    assert.deepEqual(interrupted, ["chat"]); assert.equal(recovered.get("chat")?.[0].text, "Restore after workspace change"); assert.equal(snapshots, 1); assert.ok(posts.some((post) => post.type === "workspaceContextChanged"));
  });
  test("unchanged folders leave a connected generation and its queue intact", async () => {
    enqueue("active"); enqueue("queued"); await service.handleFoldersChanged("chat"); assert.deepEqual(interrupted, []); assert.equal(generations.getQueue("chat").length, 1); assert.equal(recovered.size, 0); assert.equal(snapshots, 1);
  });
});

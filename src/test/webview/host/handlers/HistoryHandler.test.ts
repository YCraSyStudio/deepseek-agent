import assert from "node:assert/strict";
import type * as vscode from "vscode";
import type { WebviewToHandlerMessage } from "@/contracts";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import type { HistoryManager } from "@/vscode/storage/HistoryManager";
import { HistoryHandler } from "@/vscode/webviews/handlers/HistoryHandler";
import { dialogs } from "../../../support/VsCodeMock";

suite("history handler characterization", () => {
  setup(() => dialogs.reset());

  test("lists summaries without loading message bodies", async () => {
    const h = harness();
    await h.send({ type: "getHistory" });
    assert.deepEqual(h.posts, [{ type: "history", conversations: [{ id: "one", title: "Current chat" }] }]);
  });

  test("loads presentation messages without exposing provider transcript or compaction context", async () => {
    const h = harness();
    h.record.messages[0]!.contextContent = "private context";
    h.record.messages[0]!.providerTranscript = { schemaVersion: 1, provider: "deepseek", status: "complete", messages: [] };
    await h.send({ type: "loadConversation", requestId: "load", id: "one" });
    const post = h.last("conversationLoaded");
    assert.equal(post.requestId, "load");
    const conversation = post.conversation as StoredConversation;
    assert.equal(conversation.messages[0]!.content, "hello");
    assert.equal("contextContent" in conversation.messages[0]!, false);
    assert.equal("providerTranscript" in conversation.messages[0]!, false);
    assert.deepEqual(h.events, ["previews:one", "loaded:one"]);
  });

  test("returns a correlated error when loading a missing conversation", async () => {
    const h = harness();
    await h.send({ type: "loadConversation", requestId: "missing", id: "absent" });
    assert.deepEqual(h.last("historyError"), { type: "historyError", requestId: "missing", error: "Conversation not found" });
  });

  test("returns the last 200 messages and pages backwards without omissions or duplicates", async () => {
    const h = harness();
    h.record.messages = Array.from({ length: 405 }, (_, i) => ({ id: String(i), role: "user", content: String(i), timestamp: i }));
    await h.send({ type: "loadConversation", requestId: "load", id: "one" });
    const loaded = h.last("conversationLoaded").conversation as { messages: Array<{ id: string }>; historyCursor: string; hasEarlierMessages: boolean };
    assert.equal(loaded.messages.length, 200);
    assert.equal(loaded.messages[0]!.id, "205");
    assert.equal(loaded.hasEarlierMessages, true);
    await h.send({ type: "loadConversationPage", requestId: "page-1", id: "one", cursor: loaded.historyCursor });
    const page = h.last("conversationPageLoaded");
    assert.equal((page.messages as unknown[]).length, 200);
    assert.equal((page.messages as Array<{ id: string }>)[0]!.id, "5");
    await h.send({ type: "loadConversationPage", requestId: "page-2", id: "one", cursor: page.cursor as string });
    const first = h.last("conversationPageLoaded");
    assert.deepEqual((first.messages as Array<{ id: string }>).map((m) => m.id), ["0", "1", "2", "3", "4"]);
    assert.equal(first.hasEarlierMessages, false);
    assert.equal(first.cursor, undefined);
  });

  test("limits pages by serialized bytes while still returning a single oversized message", async () => {
    const h = harness();
    h.record.messages = Array.from({ length: 3 }, (_, i) => ({ id: String(i), role: "user", content: "x".repeat(3 * 1024 * 1024), timestamp: i }));
    await h.send({ type: "loadConversation", requestId: "large", id: "one" });
    const page = h.last("conversationLoaded").conversation as { messages: unknown[]; hasEarlierMessages: boolean };
    assert.equal(page.messages.length, 1);
    assert.equal(page.hasEarlierMessages, true);
    h.record.messages[2]!.content = "x".repeat(5 * 1024 * 1024);
    await h.send({ type: "loadConversation", requestId: "oversized", id: "one" });
    assert.equal((h.last("conversationLoaded").conversation as typeof page).messages.length, 1);
  });

  for (const value of ["-1", "1.5", "999", "NaN"]) {
    test(`rejects invalid history cursor ${value}`, async () => {
      const h = harness();
      await h.send({ type: "loadConversationPage", requestId: "invalid", id: "one", cursor: Buffer.from(value).toString("base64url") });
      assert.match(h.last("historyError").error as string, /Invalid conversation history cursor/);
      assert.equal(h.last("historyError").requestId, "invalid");
    });
  }

  test("an empty conversation has no earlier page", async () => {
    const h = harness(); h.record.messages = [];
    await h.send({ type: "loadConversationPage", requestId: "empty", id: "one", cursor: "MA" });
    assert.deepEqual(h.last("conversationPageLoaded").messages, []);
    assert.equal(h.last("conversationPageLoaded").hasEarlierMessages, false);
  });

  test("ignores an older load that finishes after the user's newer selection", async () => {
    const h = harness();
    let release!: (record: StoredConversation) => void;
    h.manager.getById = (id: string) => id === "slow" ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(h.record);
    h.handler.handle({ type: "loadConversation", requestId: "old", id: "slow" }, h.view);
    await h.send({ type: "loadConversation", requestId: "new", id: "one" });
    release(h.record); await flush();
    assert.deepEqual(h.posts.filter((p) => p.type === "conversationLoaded").map((p) => p.requestId), ["new"]);
  });

  test("cancelling deletion leaves history and running work untouched", async () => {
    const h = harness();
    await h.send({ type: "deleteConversation", id: "one" });
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.posts, []);
  });

  test("confirmed deletion stops work, deletes the observed revision and finalizes cleanup", async () => {
    const h = harness(); dialogs.warning = "Delete";
    await h.send({ type: "deleteConversation", id: "one" });
    assert.deepEqual(h.events, ["before:one", "delete:one:2", "deleted:one", "permanent:one"]);
    assert.equal(h.last("conversationDeleted").id, "one");
    assert.equal(h.last("history").type, "history");
  });

  test("undo restores the deleted record without permanently cleaning its resources", async () => {
    const h = harness(); dialogs.warning = "Delete"; dialogs.information = "Undo";
    await h.send({ type: "deleteConversation", id: "one" });
    assert.ok(h.events.includes("restore:one"));
    assert.ok(!h.events.includes("permanent:one"));
  });

  test("undo does not overwrite a newer record with the same ID", async () => {
    const h = harness(); dialogs.warning = "Delete"; dialogs.information = "Undo"; h.restore = false;
    await h.send({ type: "deleteConversation", id: "one" });
    assert.match(h.last("historyError").error as string, /newer conversation/);
    assert.ok(h.events.includes("permanent:one"));
  });

  test("a concurrent update prevents deletion and reports the conflict", async () => {
    const h = harness(); dialogs.warning = "Delete"; h.deleted = false;
    await h.send({ type: "deleteConversation", id: "one" });
    assert.match(h.last("historyError").error as string, /another window/);
    assert.ok(!h.events.includes("deleted:one"));
    assert.ok(!h.events.includes("permanent:one"));
  });

  test("deleting an absent record only refreshes history", async () => {
    const h = harness();
    await h.send({ type: "deleteConversation", id: "absent" });
    assert.equal(dialogs.warnings.length, 0);
    assert.deepEqual(h.events, []);
    assert.equal(h.posts.length, 1);
  });

  for (const undo of [false, true]) {
    test(`bulk deletion cleans up or restores only records actually deleted, undo=${undo}`, async () => {
      const h = harness(); dialogs.warning = "Delete all"; dialogs.information = undo ? "Undo" : undefined;
      h.manager.getById = async (id: string) => id === "absent" ? undefined : { ...h.record, id };
      h.manager.deleteMany = async () => ["one"];
      await h.send({ type: "deleteConversations", ids: ["one", "conflicted", "absent"] });
      assert.deepEqual(h.posts.filter((p) => p.type === "conversationDeleted").map((p) => p.id), ["one"]);
      assert.ok(h.events.includes(undo ? "restore:one" : "permanent:one"));
      assert.ok(!h.events.includes("restore:conflicted"));
      assert.ok(!h.events.includes("permanent:conflicted"));
    });
  }

  test("ignores messages belonging to another handler", async () => {
    const h = harness(); await h.send({ type: "getConfig" });
    assert.deepEqual(h.posts, []); assert.deepEqual(h.events, []);
  });

  test("reports non-Error repository failures as text", async () => {
    const h = harness(); h.manager.getSummaries = () => Promise.reject("storage unavailable");
    await h.send({ type: "getHistory" });
    assert.equal(h.last("historyError").error, "storage unavailable");
  });

  test("an absent page returns a correlated error", async () => {
    const h = harness();
    await h.send({ type: "loadConversationPage", requestId: "missing-page", id: "absent", cursor: "MA" });
    assert.deepEqual(h.last("historyError"), { type: "historyError", requestId: "missing-page", error: "Conversation not found" });
  });

  test("an older load cannot replace the selection when image previews finish late", async () => {
    const h = harness();
    let release!: () => void;
    let count = 0;
    const handler = new HistoryHandler(h.manager as unknown as HistoryManager, undefined, undefined, undefined, undefined,
      async () => { if (++count === 1) { await new Promise<void>((resolve) => { release = resolve; }); } });
    handler.handle({ type: "loadConversation", requestId: "old", id: "one" }, h.view);
    await flush();
    handler.handle({ type: "loadConversation", requestId: "new", id: "one" }, h.view);
    await flush(); release(); await flush();
    assert.deepEqual(h.posts.filter((p) => p.type === "conversationLoaded").map((p) => p.requestId), ["new"]);
  });

  test("an empty bulk delete refreshes without prompting", async () => {
    const h = harness();
    await h.send({ type: "deleteConversations", ids: ["absent"] });
    assert.equal(dialogs.warnings.length, 0);
    assert.equal(h.posts.length, 1);
    assert.equal(h.posts[0]!.type, "history");
  });

  test("cancelling a bulk delete does not stop or remove conversations", async () => {
    const h = harness();
    await h.send({ type: "deleteConversations", ids: ["one"] });
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.posts, []);
  });

  test("bulk undo cleans resources if a newer record prevents restoration", async () => {
    const h = harness(); dialogs.warning = "Delete all"; dialogs.information = "Undo"; h.restore = false;
    await h.send({ type: "deleteConversations", ids: ["one"] });
    assert.ok(h.events.includes("restore:one"));
    assert.ok(h.events.includes("permanent:one"));
    assert.equal(h.posts.filter((p) => p.type === "history").length, 2);
  });

  test("reports repository failures instead of claiming deletion succeeded", async () => {
    const h = harness(); dialogs.warning = "Delete";
    h.manager.delete = async () => { throw new Error("disk unavailable"); };
    await h.send({ type: "deleteConversation", id: "one" });
    assert.equal(h.last("historyError").error, "disk unavailable");
    assert.ok(!h.events.includes("deleted:one"));
  });
});

async function flush() { for (let i = 0; i < 8; i++) { await new Promise<void>((resolve) => setImmediate(resolve)); } }

function harness() {
  const posts: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const record: StoredConversation = { schemaVersion: 2, workspaceUri: "", workspaceBinding: { schemaVersion: 1, uri: "", name: "", revision: "1", folders: [], capabilities: { files: false, search: false, git: false, terminal: false } }, id: "one", title: "Current chat", model: "deepseek-flash", createdAt: 1, updatedAt: 2,
    messages: [{ id: "user", role: "user", content: "hello" }] };
  const view = { webview: { postMessage: async (p: Record<string, unknown>) => { posts.push(p); return true; } } } as unknown as vscode.WebviewView;
  const state = { deleted: true, restore: true };
  const manager = {
    getSummaries: async () => [{ id: "one", title: "Current chat" }],
    getById: async (id: string): Promise<StoredConversation | undefined> => id === "one" ? record : undefined,
    delete: async (id: string, revision?: number) => { events.push(`delete:${id}:${revision}`); return state.deleted; },
    deleteMany: async (_ids: unknown): Promise<string[]> => ["one"],
    saveIfAbsent: async (conversation: StoredConversation) => { events.push(`restore:${conversation.id}`); return state.restore; },
  };
  const handler = new HistoryHandler(manager as unknown as HistoryManager,
    (c) => { events.push(`loaded:${c.id}`); return undefined; },
    (id) => { events.push(`deleted:${id}`); },
    async (id) => { events.push(`before:${id}`); },
    async (c) => { events.push(`permanent:${c.id}`); },
    async (c) => { events.push(`previews:${c.id}`); });
  return Object.assign(state, { posts, events, record, manager, handler, view,
    async send(message: WebviewToHandlerMessage) { handler.handle(message, view); await flush(); },
    last(type: string) { const post = [...posts].reverse().find((p) => p.type === type); assert.ok(post, `Missing ${type}`); return post; },
  });
}

import assert from "node:assert/strict";
import { createElement } from "react";
import HistoryView from "@webview/views/historyView/HistoryView";
import { VsCodeProvider } from "@webview/views/chatView/contexts";
import { DEFAULT_CONFIG } from "@/contracts";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("mounted history activity and filtering", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  const conversations = (count = 2) => Array.from({ length: count }, (_, i) => ({ id: `chat-${i}`, title: `Chat ${String(i).padStart(2, "0")}`,
    workspaceUri: `file:///workspace-${i % 2}`, createdAt: i + 1, updatedAt: i + 1, messageCount: i + 1 }));
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  async function render() { await h.render(createElement(VsCodeProvider, { children: createElement(HistoryView) })); }
  const titles = () => [...h.container.querySelectorAll(".title")].map(node => node.textContent);
  test("reports that history is unavailable outside the host", async () => {
    await h.render(createElement(HistoryView));
    assert.equal(h.query(".historyList").getAttribute("aria-busy"), "false");
    assert.match(h.query('[role="alert"]').textContent!, /outside|unavailable/i); assert.deepEqual(h.posts, []);
  });
  test("renders activity updates, pending queues and terminal removal per conversation", async () => {
    await render(); await h.message({ type: "history", conversations: conversations() });
    const activity = (status: string, queuedMessages: number) => h.message({ type: "generationActivityChanged", conversationId: "chat-0", generationId: "g", status, queuedMessages });
    await activity("running", 0); assert.equal(h.query(".historyActivity").textContent, "running");
    await activity("cancelling", 0); assert.equal(h.query(".historyActivity").textContent, "cancelling");
    await activity("settled", 2); assert.equal(h.query(".historyActivity").textContent, "queued");
    await activity("settled", 0); assert.equal(h.container.querySelector(".historyActivity"), null);
  });
  test("restores activity from generation snapshots and replaces stale activity", async () => {
    await render(); await h.message({ type: "history", conversations: conversations() });
    const generation = (conversationId: string, status: string) => ({ conversationId, status, generationId: conversationId,
      content: "", timeline: [], toolCalls: [], queue: [], userMessage: { id: "user", role: "user", content: "Task" } });
    await h.message({ type: "generationSnapshot", generations: [generation("chat-0", "streaming"), generation("chat-1", "cancelling")], recoveredDrafts: [] });
    assert.deepEqual([...h.container.querySelectorAll(".historyActivity")].map(node => node.textContent), ["cancelling", "running"]);
    await h.message({ type: "generationSnapshot", generations: [], recoveredDrafts: [] });
    assert.equal(h.container.querySelector(".historyActivity"), null);
  });
  test("ignores request-scoped history errors and uses fallback text for empty general failures", async () => {
    await render(); await h.message({ type: "history", conversations: conversations() });
    await h.message({ type: "historyError", requestId: "other-request", error: "irrelevant" });
    assert.equal(h.container.querySelector('[role="alert"]'), null); assert.equal(titles().length, 2);
    await h.message({ type: "historyError", error: "" }); assert.match(h.query('[role="alert"]').textContent!, /could not be loaded/i);
    await h.click(".historyError button"); assert.equal(h.query(".historyList").getAttribute("aria-busy"), "true");
    await h.message({ type: "history", conversations: [] }); assert.equal(h.container.querySelector('[role="alert"]'), null);
  });
  test("hides history in incognito and accepts configuration updates that omit the history field", async () => {
    await render(); await h.message({ type: "history", conversations: conversations() });
    await h.message({ type: "configLoaded", revision: 1, config: { ...DEFAULT_CONFIG, historyEnabled: false } });
    assert.equal(h.query<HTMLElement>(".historyToolbar").hidden, true); assert.equal(titles().length, 0);
    await h.message({ type: "configUpdateResult", requestId: "save", revision: 2, operation: "save", status: "success", config: {} });
    assert.equal(h.query<HTMLElement>(".historyToolbar").hidden, true);
    await h.message({ type: "configUpdateResult", requestId: "save", revision: 3, operation: "save", status: "success", config: { historyEnabled: true } });
    assert.equal(h.query<HTMLElement>(".historyToolbar").hidden, false); assert.equal(titles().length, 2);
  });
  test("resets a workspace filter when its last conversation disappears", async () => {
    await render(); await h.message({ type: "history", conversations: conversations() });
    await h.input("#historyWorkspaceFilter", "file:///workspace-0"); assert.deepEqual(titles(), ["Chat 00"]);
    await h.message({ type: "conversationDeleted", id: "chat-0" });
    assert.deepEqual(titles(), ["Chat 01"]); assert.notEqual(h.query<HTMLSelectElement>("#historyWorkspaceFilter").value, "file:///workspace-0");
  });
  test("filters workspace URIs, deletes only matches and ignores invalid sort choices", async () => {
    await render(); await h.message({ type: "history", conversations: conversations(4) });
    await h.input("#historySearch", "workspace-0"); assert.deepEqual(titles(), ["Chat 02", "Chat 00"]);
    await h.click(".clearBtn"); assert.deepEqual(h.last("deleteConversations").ids, ["chat-0", "chat-2"]);
    await h.input("#historySort", "invalid"); assert.deepEqual(titles(), ["Chat 02", "Chat 00"]);
    await h.input("#historySearch", "unmatched"); assert.match(h.query(".historyState").textContent!, /match/i);
  });
  test("clamps the current history page when a refresh removes the last page", async () => {
    await render(); await h.message({ type: "history", conversations: conversations(30) });
    await h.click(h.container.querySelectorAll<HTMLButtonElement>(".historyPagination button")[1]); assert.equal(titles().length, 5);
    await h.message({ type: "history", conversations: conversations(2) }); assert.equal(titles().length, 2);
    assert.equal(h.container.querySelector(".historyPagination"), null);
    await h.message({ type: "history", conversations: conversations(30) }); assert.equal(titles().length, 25);
    assert.equal(h.query<HTMLButtonElement>(".historyPagination button").disabled, true);
  });
});

import assert from "node:assert/strict";
import { createElement } from "react";
import App from "@webview/App";
import { DEFAULT_CONFIG } from "@/contracts";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("mounted extension UI characterization", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); await h.render(createElement(App)); });
  teardown(async () => { await h.dispose(); });
  const config = async (revision = 1, patch = {}) => h.message({ type: "configLoaded", revision, config: { ...DEFAULT_CONFIG, ...patch } });

  test("starts in chat and navigates to settings and back without losing the composer", async () => {
    assert.ok(h.container.querySelector("textarea"));
    assert.equal(h.last("getConfig").type, "getConfig");
    await h.click(".settingsBtn");
    assert.ok(h.container.querySelector(".settingsView"));
    await config();
    assert.ok(h.container.querySelector("#settings-tab-general[aria-selected='true']"));
    await h.click(".backBtn");
    assert.equal(h.container.querySelector(".settingsView"), null);
    assert.ok(h.container.querySelector("textarea"));
  });

  test("new chat waits for the matching navigation acknowledgement", async () => {
    await config(1, { historyEnabled: false });
    await h.input("textarea", "draft before navigation");
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "draft before navigation");
    await h.click(".newChatBtn");
    const request = h.last("newConversation"); assert.equal(typeof request.requestId, "string");
    await h.message({ type: "newConversationReady", requestId: "stale" });
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "draft before navigation");
    await h.message({ type: "newConversationReady", requestId: request.requestId });
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "");
  });

  test("incognito toggle waits for its saved configuration and disables duplicate clicks", async () => {
    await config();
    await h.click(".incognitoBtn");
    const request = h.last("saveConfig"); assert.deepEqual(request.config, { historyEnabled: false });
    assert.equal(h.query<HTMLButtonElement>(".incognitoBtn").disabled, true);
    const count = h.posts.filter((post) => post.type === "saveConfig").length;
    await h.click(".incognitoBtn"); assert.equal(h.posts.filter((post) => post.type === "saveConfig").length, count);
    await h.message({ type: "configUpdateResult", requestId: request.requestId, revision: 2, operation: "save", status: "success", config: { ...DEFAULT_CONFIG, historyEnabled: false } });
    assert.equal(h.query(".incognitoBtn").getAttribute("aria-pressed"), "true");
    assert.equal(h.query<HTMLButtonElement>(".incognitoBtn").disabled, false);
  });

  test("history renders returned conversations and requests a correlated load", async () => {
    await config(); await h.click(".historyBtn");
    assert.equal(h.last("getHistory").type, "getHistory");
    await h.message({ type: "history", conversations: [{ id: "chat-1", title: "Working chat", workspaceUri: "file:///project", createdAt: 1, updatedAt: 2, messageCount: 2 }] });
    assert.match(h.query(".historyList").textContent!, /Working chat/);
    await h.click(".openConversationBtn");
    const request = h.last("loadConversation"); assert.equal(request.id, "chat-1");
    await h.message({ type: "conversationLoaded", requestId: "outdated", conversation: conversation("Stale answer") });
    assert.ok(h.container.querySelector(".historyView"));
    await h.message({ type: "conversationLoaded", requestId: request.requestId, conversation: conversation("Loaded answer") });
    assert.equal(h.container.querySelector(".historyView"), null);
    assert.match(h.container.textContent!, /Loaded answer/);
    assert.doesNotMatch(h.container.textContent!, /Stale answer/);
  });

  test("history errors allow a retry and deleted conversations disappear", async () => {
    await config(); await h.click(".historyBtn");
    await h.message({ type: "historyError", error: "storage unavailable" });
    assert.match(h.query(".historyView").textContent!, /storage unavailable/);
    const retry = [...h.container.querySelectorAll<HTMLButtonElement>(".historyView button")].find((button) => /Retry/i.test(button.textContent!)); assert.ok(retry);
    await h.click(retry); assert.equal(h.query(".historyList").getAttribute("aria-busy"), "true");
    await h.message({ type: "history", conversations: [{ id: "chat-1", title: "Delete me", workspaceUri: "", createdAt: 1, updatedAt: 2, messageCount: 1 }] });
    await h.click(".deleteConversationBtn"); assert.equal(h.last("deleteConversation").id, "chat-1");
    await h.message({ type: "conversationDeleted", id: "chat-1" });
    assert.equal(h.container.querySelector(".historyListItem"), null);
  });

  test("settings tabs support keyboard navigation and request their host data", async () => {
    await h.click(".settingsBtn"); await config();
    assert.ok(h.last("getAvailableTools")); assert.ok(h.last("getWorkspaceInstructions"));
    await h.key("#settings-tab-general", "ArrowRight"); assert.equal(h.query("#settings-tab-api").getAttribute("aria-selected"), "true");
    await h.key("#settings-tab-api", "End"); assert.equal(h.query("#settings-tab-customization").getAttribute("aria-selected"), "true");
    await h.key("#settings-tab-customization", "Home"); assert.equal(h.query("#settings-tab-general").getAttribute("aria-selected"), "true");
  });

  async function readyToSend(text = "Explain the file") {
    await config(1, { historyEnabled: false });
    await h.message({ type: "apiKeyStatus", status: "configured" });
    const request = h.last("getWorkspaceContext");
    await h.message({ type: "workspaceContextChanged", requestId: request.requestId, context: { state: "empty", binding: conversation("").workspaceBinding } });
    await h.input("textarea", text);
    assert.equal(h.query<HTMLButtonElement>(".sendBtn").disabled, false);
  }
  async function startTurn(text = "Explain the file") {
    await readyToSend(text); await h.click(".sendBtn");
    const sent = h.last("sendMessage");
    await h.message({ type: "generationAccepted", generationId: "turn-1", conversationId: "chat-1", clientRequestId: sent.clientRequestId });
    await h.message({ type: "addMessage", conversationId: "chat-1", generationId: "turn-1", message: { role: "user", content: text, generationId: "turn-1" } });
    return sent;
  }

  test("submits the composed message and displays its streamed answer exactly once", async () => {
    const sent = await startTurn();
    assert.equal(sent.text, "Explain the file"); assert.equal(sent.workspaceRevision, "1");
    await h.message({ type: "showTyping", conversationId: "chat-1", generationId: "turn-1" });
    await h.message({ type: "streamTimelineDelta", conversationId: "chat-1", generationId: "turn-1", eventId: "text", eventType: "content", content: "First " });
    await h.message({ type: "streamTimelineDelta", conversationId: "chat-1", generationId: "turn-1", eventId: "text", eventType: "content", content: "answer" });
    await h.message({ type: "streamDone", conversationId: "chat-1", generationId: "turn-1", status: "completed", finish_reason: "stop" });
    assert.match(h.container.textContent!, /First answer/);
    assert.equal(h.container.querySelector(".stopBtn"), null);
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "");
  });

  test("the stop button cancels the selected generation and ignores output from another chat", async () => {
    await startTurn();
    await h.message({ type: "showTyping", conversationId: "chat-1", generationId: "turn-1" });
    await h.click(".stopBtn");
    const request = h.last("cancelGeneration");
    assert.equal(request.generationId, "turn-1"); assert.equal(request.conversationId, "chat-1");
    await h.message({ type: "streamTimelineDelta", conversationId: "other", generationId: "other", eventId: "late", eventType: "content", content: "Wrong conversation output" });
    await h.message({ type: "streamDone", conversationId: "chat-1", generationId: "turn-1", status: "cancelled" });
    assert.doesNotMatch(h.container.textContent!, /Wrong conversation output/);
    assert.equal(h.container.querySelector(".stopBtn"), null);
  });

  test("a rejected request keeps the draft available for correction", async () => {
    await readyToSend("Keep my draft"); await h.click(".sendBtn"); const sent = h.last("sendMessage");
    await h.message({ type: "requestRejected", requestId: sent.clientRequestId, action: "sendMessage", error: "Workspace revision changed" });
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "Keep my draft");
    assert.match(h.container.textContent!, /Workspace revision changed/);
  });

  for (const accept of [false, true]) {
    test(`tool approval sends an explicit decision for the selected call, accept=${accept}`, async () => {
      await startTurn();
      const calls = [{ id: "edit-1", type: "function", function: { name: "edit_file", arguments: JSON.stringify({ path: "file.ts", search: "before", replace: "after" }) } }];
      await h.message({ type: "toolCallStarted", conversationId: "chat-1", generationId: "turn-1", toolCalls: calls, round: 1 });
      await h.message({ type: "toolCallConfirmationRequired", conversationId: "chat-1", generationId: "turn-1", toolCalls: calls, round: 1, autoExecute: false });
      assert.match(h.query(".toolCallModal").textContent!, /edit_file/);
      await h.click(".toolCallOpenFile"); assert.equal(h.last("openFile").path, "file.ts");
      await h.click(accept ? ".toolCallDecisionOption.primary" : ".toolCallDecisionOption:not(.primary)");
      const result = h.last("executeToolCall");
      assert.equal(result.toolCallId, "edit-1"); assert.equal(result.generationId, "turn-1"); assert.equal(result.action, accept ? "execute" : "reject");
      await h.message({ type: "toolCallActionAccepted", conversationId: "chat-1", generationId: "turn-1", toolCallId: "edit-1", status: accept ? "running" : "rejected" });
      assert.equal(h.container.querySelector(".toolCallModal"), null);
    });
  }

  test("history can be paged, searched, sorted and grouped by workspace", async () => {
    await config(); await h.click(".historyBtn");
    const chats = Array.from({ length: 30 }, (_, index) => ({ id: `chat-${index}`, title: `Conversation ${String(index).padStart(2, "0")}`, workspaceUri: index < 15 ? "file:///alpha" : "file:///beta", createdAt: index, updatedAt: index, messageCount: index }));
    await h.message({ type: "history", conversations: chats });
    assert.equal(h.container.querySelectorAll(".historyListItem").length, 25);
    const pageButtons = h.container.querySelectorAll<HTMLButtonElement>(".historyPagination button");
    await h.click(pageButtons[1]!); assert.equal(h.container.querySelectorAll(".historyListItem").length, 5);
    await h.click(pageButtons[0]!); assert.equal(h.container.querySelectorAll(".historyListItem").length, 25);
    await h.input("#historySort", "title_asc");
    assert.match(h.query(".historyListItem .title").textContent!, /Conversation 00/);
    await h.input("#historySort", "title_desc"); assert.match(h.query(".historyListItem .title").textContent!, /Conversation 29/);
    await h.input("#historySort", "date_asc"); assert.match(h.query(".historyListItem .title").textContent!, /Conversation 00/);
    await h.input("#historyWorkspaceFilter", "file:///alpha"); assert.equal(h.container.querySelectorAll(".historyListItem").length, 15);
    await h.click(".groupToggle"); assert.equal(h.query(".groupToggle").getAttribute("aria-pressed"), "true");
    const search = h.query<HTMLInputElement>(".historyView input"); await h.input(`#${search.id}`, "Conversation 03");
    assert.equal(h.container.querySelectorAll(".historyListItem").length, 1);
  });

  test("security settings stay pending until their own host acknowledgement", async () => {
    await h.click(".settingsBtn"); await config(); await h.click("#settings-tab-tools");
    await h.input("#permissionMode", "full-access"); const request = h.last("saveConfig");
    assert.deepEqual(request.config, { permissionMode: "full-access" });
    assert.equal(h.query<HTMLSelectElement>("#permissionMode").disabled, true);
    await h.message({ type: "configUpdateResult", requestId: "other", revision: 2, operation: "save", status: "success", config: DEFAULT_CONFIG });
    assert.equal(h.query<HTMLSelectElement>("#permissionMode").disabled, true);
    await h.message({ type: "configUpdateResult", requestId: request.requestId, revision: 3, operation: "save", status: "error", config: DEFAULT_CONFIG });
    assert.equal(h.query<HTMLSelectElement>("#permissionMode").disabled, false);
    assert.match(h.query(".notification").textContent!, /save/i);
  });

  test("workspace instructions preserve selected root and ignore stale opening results", async () => {
    await h.click(".settingsBtn"); await config(); await h.click("#settings-tab-customization");
    await h.message({ type: "workspaceInstructions", roots: [{ uri: "file:///alpha", name: "Alpha", exists: false }, { uri: "file:///beta", name: "Beta", exists: true }], preferredRootUri: "file:///beta" });
    assert.equal(h.query<HTMLSelectElement>("#workspaceInstructionsRoot").value, "file:///beta");
    const edit = [...h.container.querySelectorAll<HTMLButtonElement>("#settings-panel-customization button")].find((button) => /Edit AGENTS.md/i.test(button.textContent!)); assert.ok(edit);
    await h.click(edit); const request = h.last("openWorkspaceInstructions"); assert.equal(request.rootUri, "file:///beta");
    await h.message({ type: "openWorkspaceInstructionsResult", requestId: "old", success: true }); assert.equal(edit.disabled, true);
    await h.message({ type: "openWorkspaceInstructionsResult", requestId: request.requestId, success: false, error: "Read only" });
    assert.equal(edit.disabled, false); assert.match(h.query("#settings-panel-customization").textContent!, /Read only/);
  });

  for (const phase of ["stop-work", "exit-incognito"]) {
    test(`incognito prompts return the user's choice with its original request ID, phase=${phase}`, async () => {
      await config(); await h.click(".incognitoBtn"); const request = h.last("saveConfig");
      await h.message({ type: "historyTransitionRequired", requestId: "other", phase, direction: "enter-incognito", activeGenerations: 1, queuedMessages: 1 });
      assert.equal(h.container.querySelector(".historyTransitionPanel"), null);
      await h.message({ type: "historyTransitionRequired", requestId: request.requestId, phase, direction: phase === "stop-work" ? "enter-incognito" : "exit-incognito", activeGenerations: 1, queuedMessages: 1 });
      await h.click(".historyTransitionAction.primary");
      assert.equal(h.last("resolveHistoryTransition").decision, phase === "stop-work" ? "stop" : "save");
      assert.equal(h.last("resolveHistoryTransition").requestId, request.requestId);
      await h.key(".historyTransitionPanel", "Escape");
      assert.equal(h.last("resolveHistoryTransition").decision, "cancel");
    });
  }

  test("pages earlier history and ignores stale navigation acknowledgements", async () => {
    await config(); await h.click(".historyBtn");
    await h.message({ type: "history", conversations: [{ id: "chat-1", title: "Paged chat", workspaceUri: "", createdAt: 1, updatedAt: 2, messageCount: 3 }] });
    await h.click(".openConversationBtn");
    const load = h.last("loadConversation");
    await h.message({
      type: "conversationLoaded",
      requestId: load.requestId,
      conversation: { ...conversation("Loaded answer"), hasEarlierMessages: true, historyCursor: "cursor-1" },
    });
    assert.ok(h.container.querySelector(".showEarlierMessages"));
    await h.click(".showEarlierMessages");
    const page = h.last("loadConversationPage");
    assert.equal(page.id, "chat-1");
    assert.equal(page.cursor, "cursor-1");
    await h.message({ type: "conversationPageLoaded", requestId: "stale", id: "chat-1", messages: [{ id: "old", role: "user", content: "Stale earlier" }], hasEarlierMessages: false, cursor: "cursor-0" });
    assert.doesNotMatch(h.container.textContent!, /Stale earlier/);
    await h.message({ type: "conversationPageLoaded", requestId: page.requestId, id: "chat-1", messages: [{ id: "old", role: "user", content: "Earlier question" }], hasEarlierMessages: false, cursor: "cursor-0" });
    assert.match(h.container.textContent!, /Earlier question/);
    assert.equal(h.container.querySelector(".showEarlierMessages"), null);

    await config(); await h.click(".historyBtn");
    await h.message({ type: "history", conversations: [{ id: "chat-1", title: "Paged chat", workspaceUri: "", createdAt: 1, updatedAt: 2, messageCount: 3 }] });
    await h.click(".openConversationBtn");
    const rejectedRequest = h.last("loadConversation");
    await h.message({ type: "conversationLoadRejected", requestId: "stale" });
    assert.match(h.container.textContent!, /Earlier question/);
    await h.message({ type: "conversationLoadRejected", requestId: rejectedRequest.requestId });
    assert.equal(h.container.querySelector(".historyView") !== null, true);
  });

  test("clear chat resets the loaded conversation and history errors settle navigation", async () => {
    await config(); await h.click(".historyBtn");
    await h.message({ type: "history", conversations: [{ id: "chat-1", title: "Cleared chat", workspaceUri: "", createdAt: 1, updatedAt: 2, messageCount: 1 }] });
    await h.click(".openConversationBtn");
    const load = h.last("loadConversation");
    await h.message({ type: "conversationLoaded", requestId: load.requestId, conversation: conversation("Answer to clear") });
    assert.match(h.container.textContent!, /Answer to clear/);
    await h.message({ type: "clearChat" });
    assert.doesNotMatch(h.container.textContent!, /Answer to clear/);

    await config(); await h.click(".newChatBtn");
    const navigation = h.last("newConversation");
    await h.message({ type: "historyError", requestId: navigation.requestId, error: "navigation failed" });
    await h.message({ type: "newConversationReady", requestId: navigation.requestId });
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "");
  });

  test("ignores extra history transitions and disables incognito before configuration loads", async () => {
    await h.click(".incognitoBtn");
    assert.equal(h.posts.filter((post) => post.type === "saveConfig").length, 0);
    await config(); await h.click(".incognitoBtn");
    const request = h.last("saveConfig");
    await h.message({ type: "historyTransitionRequired", requestId: request.requestId, phase: "stop-work", direction: "enter-incognito", activeGenerations: 1, queuedMessages: 1 });
    assert.ok(h.container.querySelector(".historyTransitionPanel"));
    await h.message({ type: "historyTransitionRequired", requestId: "other-request", phase: "exit-incognito", direction: "exit-incognito", activeGenerations: 2, queuedMessages: 2 });
    await h.click(".historyTransitionAction.primary");
    assert.equal(h.last("resolveHistoryTransition").requestId, request.requestId);
  });

  test("settings reset posts a request and displays success only after confirmation", async () => {
    await h.click(".settingsBtn"); await config();
    const reset = [...h.container.querySelectorAll<HTMLButtonElement>(".settingsView > button")].find((button) => /Reset/i.test(button.textContent!)); assert.ok(reset);
    await h.click(reset); const request = h.last("resetConfig"); assert.equal(reset.disabled, true);
    await h.message({ type: "configUpdateResult", requestId: request.requestId, revision: 2, operation: "reset", status: "success", config: DEFAULT_CONFIG });
    assert.match(h.query(".notification").textContent!, /reset/i);
    assert.equal(reset.disabled, false);
    await h.click(".notification button"); assert.equal(h.container.querySelector(".notification"), null);
  });
});

function conversation(answer: string) {
  return { schemaVersion: 2, id: "chat-1", title: "Working chat", createdAt: 1, updatedAt: 2, model: DEFAULT_CONFIG.model,
    workspaceUri: "", workspaceBinding: { schemaVersion: 1, uri: "", name: "Empty", revision: "1", folders: [], capabilities: { files: false, search: false, git: false, terminal: false } },
    messages: [{ id: "user", role: "user", content: "Question" }, { id: "answer", role: "assistant", content: answer, timeline: [{ id: "text", type: "content", content: answer }] }] };
}

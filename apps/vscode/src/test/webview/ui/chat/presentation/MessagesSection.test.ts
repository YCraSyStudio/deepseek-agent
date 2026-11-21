import assert from "node:assert/strict";
import { act, createElement } from "react";
import MessagesSection from "@webview/views/chatView/sections/messagesSection/MessagesSection";
import { VsCodeProvider } from "@webview/views/chatView/contexts";
import type { ChatMessage, MessagesSectionProps } from "@webview/views/chatView/ChatViewTypes";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

suite("mounted message list navigation", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  const messages = (count: number): ChatMessage[] => Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, role: "user", content: `Question ${index}` }));
  async function render(props: MessagesSectionProps = {}) {
    await h.render(createElement(VsCodeProvider, { children: createElement(MessagesSection, props) }));
  }
  async function scroll() {
    await act(async () => { h.query(".msgList").dispatchEvent(new h.dom.window.Event("scroll", { bubbles: true })); });
  }
  test("expands earlier messages while retaining the visible scroll anchor and supports jumping to latest", async () => {
    await render({ messages: messages(100) });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    const list = h.query<HTMLDivElement>(".msgList");
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => list.querySelectorAll(".message").length * 100 },
      clientHeight: { configurable: true, value: 300 },
    });
    const initialCount = list.querySelectorAll(".message").length;
    list.scrollTop = 100; await scroll();
    assert.ok(h.container.querySelector(".jumpToLatest"));
    await h.click(".showEarlierMessages");
    const expandedCount = list.querySelectorAll(".message").length;
    assert.ok(expandedCount > initialCount);
    assert.equal(list.scrollTop, 100 + (expandedCount - initialCount) * 100);
    await h.click(".jumpToLatest");
    assert.equal(list.scrollTop, list.scrollHeight);
    assert.equal(h.container.querySelector(".jumpToLatest"), null);
    list.scrollTop = list.scrollHeight - list.clientHeight; await scroll();
    assert.equal(h.container.querySelector(".jumpToLatest"), null);
  });
  test("requests the next saved history page with its conversation and cursor", async () => {
    await render({ conversationId: "chat", historyCursor: "cursor", messages: messages(2) });
    await h.click(".showEarlierMessages");
    const request = h.last("loadConversationPage");
    assert.equal(request.id, "chat"); assert.equal(request.cursor, "cursor"); assert.equal(typeof request.requestId, "string");
    await render({ conversationId: "chat", messages: messages(2) });
    assert.equal(h.container.querySelector(".showEarlierMessages"), null);
  });
  test("shows scoped compaction and recovery states and clears them on completion and errors", async () => {
    const props = { conversationId: "chat", activeGenerationId: "generation", messages: messages(1), isProcessing: true };
    const scope = { conversationId: "chat", generationId: "generation" };
    await render(props);
    await h.message({ type: "contextCompactionUpdated", ...scope, status: "compacting" });
    assert.match(h.query(".typingLabel").textContent!, /compact/i);
    await h.message({ type: "streamDone", ...scope, status: "completed" });
    assert.doesNotMatch(h.query(".typingLabel").textContent!, /compact|recover/i);
    await h.message({ type: "generationRecoveryStarted", ...scope });
    assert.match(h.query(".typingLabel").textContent!, /recover|concise/i);
    await h.message({ type: "streamError", ...scope, error: "connection lost" });
    assert.doesNotMatch(h.query(".typingLabel").textContent!, /compact|recover/i);
    await h.message({ type: "generationSnapshot", generations: [
      { conversationId: "other", generationId: "other", status: "compacting", toolCalls: [], timeline: [], queue: [], content: "", userMessage: messages(1)[0] },
      { conversationId: "chat", generationId: "generation", status: "compacting", toolCalls: [], timeline: [], queue: [], content: "", userMessage: messages(1)[0] },
    ], recoveredDrafts: [] });
    assert.match(h.query(".typingLabel").textContent!, /compact/i);
    await h.message({ type: "generationSnapshot", generations: [], recoveredDrafts: [] });
    assert.doesNotMatch(h.query(".typingLabel").textContent!, /compact/i);
    await h.message({ type: "clearChat" });
    await render({}); assert.ok(h.container.querySelector(".emptyState"));
  });
});

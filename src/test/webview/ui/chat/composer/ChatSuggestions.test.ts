import assert from "node:assert/strict";
import { act, createElement, useRef, useState } from "react";
import { useChatSuggestions } from "@webview/views/chatView/sections/inputArea/inputCtrl/UseChatSuggestions";
import { getVsCodeApi } from "@webview/VsCodeApi";
import { createDomHarness } from "../../../../support/DomHarness";

suite("chat suggestion editing lifecycle", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let suggestions: ReturnType<typeof useChatSuggestions>;
  function Fixture({ blocked = false, scope = "chat" }: { blocked?: boolean; scope?: string }) {
    const [input, setInput] = useState("Plan "); const textarea = useRef<HTMLTextAreaElement>(null);
    suggestions = useChatSuggestions(input, setInput, textarea, getVsCodeApi(), blocked, scope);
    return createElement("textarea", { ref: textarea, value: input, onChange: event => setInput(event.currentTarget.value), onFocus: suggestions.onFocus, onBlur: suggestions.onBlur, onSelect: suggestions.cursorChanged, onCompositionStart: suggestions.onCompositionStart, onCompositionEnd: suggestions.onCompositionEnd });
  }
  setup(async () => {
    h = await createDomHarness(); await h.render(createElement(Fixture));
    await h.message({ type: "configLoaded", revision: 1, config: { betaFeaturesEnabled: true, chatSuggestionsEnabled: true } });
    await h.message({ type: "apiKeyStatus", status: "configured" });
  });
  teardown(async () => { await h.dispose(); });
  const request = async () => { await act(async () => { suggestions.controls.request(); }); return String(h.last("getChatSuggestion").requestId); };
  const response = (requestId: string, text: string) => h.message({ type: "chatSuggestion", requestId, text });
  test("requests an explicit completion at the end and accepts it into the current draft", async () => {
    const id = await request(); assert.equal(suggestions.controls.pending, true); assert.equal(h.last("getChatSuggestion").prefix, "Plan ");
    await response(id, "the next step"); assert.equal(suggestions.controls.pending, false); assert.equal(suggestions.suggestion, "the next step");
    let accepted = false; await act(async () => { accepted = suggestions.accept(); });
    assert.equal(accepted, true); assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "Plan the next step"); assert.equal(suggestions.suggestion, "");
  });
  test("cancels a pending request during composition and permits a new request after composition ends", async () => {
    const first = await request();
    await act(async () => { suggestions.onCompositionStart(); });
    assert.equal(suggestions.controls.disabled, true); assert.equal(suggestions.controls.pending, false);
    assert.equal(h.last("cancelChatSuggestion").requestId, first);
    const count = h.posts.filter(post => post.type === "getChatSuggestion").length;
    await act(async () => { suggestions.controls.request(); }); assert.equal(h.posts.filter(post => post.type === "getChatSuggestion").length, count);
    await response(first, "stale composition response"); assert.equal(suggestions.suggestion, "");
    await act(async () => { suggestions.onCompositionEnd(); }); assert.equal(suggestions.controls.disabled, false);
    const next = await request(); await response(next, "ready"); assert.equal(suggestions.suggestion, "ready");
  });
  test("ignores stale configuration and cancels completions on a changed conversation scope", async () => {
    const id = await request();
    await h.message({ type: "configLoaded", revision: 0, config: { betaFeaturesEnabled: false, chatSuggestionsEnabled: false } });
    assert.equal(suggestions.controls.pending, true); assert.equal(suggestions.controls.visible, true);
    await h.render(createElement(Fixture, { scope: "other-chat" })); assert.equal(suggestions.controls.pending, false);
    await response(id, "old chat response"); assert.equal(suggestions.suggestion, "");
  });
  test("dismisses suggestions when the cursor moves away from the end or the field loses focus", async () => {
    const id = await request(); await response(id, "text");
    await act(async () => { h.query<HTMLTextAreaElement>("textarea").setSelectionRange(0, 0); suggestions.cursorChanged(); });
    assert.equal(suggestions.suggestion, ""); let accepted = true; await act(async () => { accepted = suggestions.accept(); }); assert.equal(accepted, false);
    const next = await request(); await response(next, "text");
    await act(async () => { h.query<HTMLTextAreaElement>("textarea").blur(); }); assert.equal(suggestions.suggestion, "");
  });
  test("caps displayed suggestions and exposes empty results without leaving a request pending", async () => {
    const id = await request(); await response(id, "x".repeat(401)); assert.equal(suggestions.suggestion.length, 400);
    const next = await request(); await response(next, ""); assert.equal(suggestions.unavailable, true); assert.equal(suggestions.controls.pending, false);
    await h.render(createElement(Fixture, { blocked: true })); assert.equal(suggestions.controls.disabled, true);
  });
});

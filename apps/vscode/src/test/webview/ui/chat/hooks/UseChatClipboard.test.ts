import assert from "node:assert/strict";
import { act, createElement } from "react";
import { useChatClipboard } from "@webview/views/chatView/hooks/UseChatClipboard";
import { getVsCodeApi } from "@webview/VsCodeApi";
import { createDomHarness } from "../../../../support/DomHarness";

suite("chat clipboard selection behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  function Chat({ connected = true }: { connected?: boolean }) {
    const handlers = useChatClipboard(connected ? getVsCodeApi() : null);
    return createElement("div", { className: "clipboard-root", ...handlers },
      createElement("textarea", { defaultValue: "First selected last" }),
      createElement("input", { className: "text-input", defaultValue: "Input selection" }),
      createElement("input", { className: "number-input", type: "number", defaultValue: "12" }),
      createElement("p", { className: "rendered" }, "Rendered answer"));
  }
  setup(async () => { h = await createDomHarness(); await h.render(createElement(Chat)); });
  teardown(async () => { await h.dispose(); });
  function selectInput(selector = "textarea", start = 6, end = 14) {
    const input = h.query<HTMLInputElement | HTMLTextAreaElement>(selector); input.focus(); input.setSelectionRange(start, end);
  }
  async function copy() {
    const written: Array<[string, string]> = [];
    const event = new h.dom.window.Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData: (type: string, value: string) => written.push([type, value]) } });
    await act(async () => { h.query(".clipboard-root").dispatchEvent(event); });
    return { written, prevented: event.defaultPrevented };
  }
  async function key(options: KeyboardEventInit = {}) {
    const event = new h.dom.window.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true, ...options });
    await act(async () => { h.query(".clipboard-root").dispatchEvent(event); });
    return event.defaultPrevented;
  }
  function selectRendered(node = h.query(".rendered")) {
    h.query<HTMLTextAreaElement>("textarea").blur();
    const range = h.dom.window.document.createRange(); range.selectNodeContents(node);
    const selection = h.dom.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  }
  test("copy writes the selected textarea substring to both native clipboard data and the host", async () => {
    selectInput(); const result = await copy();
    assert.deepEqual(result, { written: [["text/plain", "selected"]], prevented: true });
    assert.deepEqual(h.last("copyCode"), { type: "copyCode", code: "selected" });
  });
  test("keyboard copies text inputs with Ctrl+C and Command+C, including uppercase C", async () => {
    selectInput(".text-input", 0, 5);
    assert.equal(await key(), true); assert.equal(h.last("copyCode").code, "Input");
    assert.equal(await key({ ctrlKey: false, metaKey: true, key: "C" }), true);
    assert.equal(h.posts.length, 2);
  });
  test("copies rendered message selections using both clipboard and keyboard events", async () => {
    selectRendered(); assert.equal((await copy()).prevented, true);
    assert.equal(await key(), true); assert.equal(h.last("copyCode").code, "Rendered answer");
  });
  for (const options of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { key: "v" }]) {
    test(`leaves other keyboard shortcuts untouched: ${JSON.stringify(options)}`, async () => {
      selectInput(); assert.equal(await key(options), false); assert.equal(h.posts.length, 0);
    });
  }
  test("leaves empty selections, unsupported input selections and selections outside chat untouched", async () => {
    selectInput("textarea", 0, 0); assert.equal((await copy()).prevented, false); assert.equal(await key(), false);
    h.query<HTMLInputElement>(".number-input").focus(); assert.equal((await copy()).prevented, false);
    const outside = h.dom.window.document.createElement("p"); outside.textContent = "Outside"; h.dom.window.document.body.append(outside);
    selectRendered(outside); assert.equal((await copy()).prevented, false); assert.equal(await key(), false);
    outside.remove(); assert.equal(h.posts.length, 0);
  });
  test("does not intercept a copy when the host is disconnected", async () => {
    await h.render(createElement(Chat, { connected: false })); selectInput();
    assert.equal((await copy()).prevented, false); assert.equal(await key(), false); assert.equal(h.posts.length, 0);
  });
  test("enforces the selected-text size limit without intercepting oversized copies", async () => {
    const input = h.query<HTMLTextAreaElement>("textarea"); input.value = "x".repeat(2 * 1024 * 1024 + 1);
    selectInput("textarea", 0, input.value.length);
    assert.equal((await copy()).prevented, false); assert.equal(await key(), false); assert.equal(h.posts.length, 0);
    selectInput("textarea", 0, 2 * 1024 * 1024); assert.equal(await key(), true);
    assert.equal(String(h.last("copyCode").code).length, 2 * 1024 * 1024);
  });
});

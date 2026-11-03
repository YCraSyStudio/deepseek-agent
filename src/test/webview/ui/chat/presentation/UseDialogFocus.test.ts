import assert from "node:assert/strict";
import { act, createElement } from "react";
import { useDialogFocus } from "@webview/components/chatView/tools/confirmations/UseDialogFocus";
import { createDomHarness } from "../../../../support/DomHarness";

suite("dialog keyboard focus lifecycle", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let escaped: number;
  function Dialog({ open = true, present = true, empty = false, marked = false, hidden = false, onEscape = () => { escaped++; } } = {}) {
    const ref = useDialogFocus(onEscape, marked ? "marked" : "default", open);
    return createElement("div", null, createElement("button", { className: "outside" }, "Outside"),
      open && present ? createElement("section", { ref, tabIndex: -1, className: "dialog" },
        empty ? null : [createElement("button", { key: "first", className: "first" }, "First"),
          createElement("button", { key: "middle", className: "middle", "data-dialog-initial-focus": marked ? "true" : undefined }, "Middle"),
          createElement("button", { key: "last", className: "last" }, "Last")],
        hidden ? [createElement("button", { key: "disabled", disabled: true }, "Disabled"),
          createElement("button", { key: "hidden", hidden: true }, "Hidden"),
          createElement("button", { key: "aria", "aria-hidden": "true" }, "Aria hidden"),
          createElement("details", { key: "details" }, createElement("summary", null, "Summary"), createElement("button", null, "Closed details content"))] : null) : null);
  }
  setup(async () => { h = await createDomHarness(); escaped = 0; });
  teardown(async () => { await h.dispose(); });
  type Props = NonNullable<Parameters<typeof Dialog>[0]>;
  const render = (props: Props = {}) => h.render(createElement<Props>(Dialog, props));
  async function focus(selector: string) { await act(async () => { h.query<HTMLElement>(selector).focus(); }); }
  async function key(key: string, shiftKey = false) {
    const event = new h.dom.window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    await act(async () => { h.dom.window.document.dispatchEvent(event); }); return event.defaultPrevented;
  }
  const focused = (selector: string) => h.dom.window.document.activeElement === h.query(selector);
  test("focuses marked controls and restores the prior focus on close", async () => {
    await render({ open: false }); await focus(".outside");
    await render({ marked: true }); assert.equal(focused(".middle"), true);
    await render({ open: false }); assert.equal(focused(".outside"), true);
    assert.equal(await key("Escape"), false); assert.equal(escaped, 0);
  });
  test("wraps Tab and Shift+Tab at dialog boundaries while preserving ordinary keys", async () => {
    await render(); assert.equal(focused(".first"), true);
    assert.equal(await key("Tab", true), true); assert.equal(focused(".last"), true);
    assert.equal(await key("Tab"), true); assert.equal(focused(".first"), true);
    await focus(".middle"); assert.equal(await key("Tab"), false); assert.equal(await key("a"), false);
  });
  test("brings escaped focus back to the first or last control", async () => {
    await render(); await focus(".outside"); assert.equal(await key("Tab"), true); assert.equal(focused(".first"), true);
    await focus(".outside"); assert.equal(await key("Tab", true), true); assert.equal(focused(".last"), true);
  });
  test("focuses the dialog itself when no controls exist", async () => {
    await render({ empty: true }); assert.equal(focused(".dialog"), true);
    await focus(".outside"); assert.equal(await key("Tab"), true); assert.equal(focused(".dialog"), true);
  });
  test("ignores disabled and hidden controls and buttons inside closed details", async () => {
    await render({ hidden: true }); await focus("summary");
    assert.equal(await key("Tab"), true); assert.equal(focused(".first"), true);
    assert.equal(await key("Tab", true), true); assert.equal(focused("summary"), true);
  });
  test("uses the current escape callback and ignores events when the dialog has not mounted", async () => {
    await render(); await render({ onEscape: () => { escaped += 10; } });
    assert.equal(await key("Escape"), true); assert.equal(escaped, 10);
    await render({ present: false }); assert.equal(await key("Escape"), false); assert.equal(await key("Tab"), false); assert.equal(escaped, 10);
  });
  test("closing tolerates a previously focused element that was removed", async () => {
    await render({ open: false });
    const temporary = h.dom.window.document.createElement("button"); h.dom.window.document.body.append(temporary); temporary.focus();
    await render(); temporary.remove(); await render({ open: false });
    assert.equal(h.dom.window.document.activeElement?.isConnected, true);
  });
});

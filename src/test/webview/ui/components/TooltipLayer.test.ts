import assert from "node:assert/strict";
import { act, createElement } from "react";
import TooltipLayer from "@webview/components/shared/tooltip/TooltipLayer";
import { createDomHarness } from "../../../support/DomHarness";

suite("tooltip layer lifecycle", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => {
    h = await createDomHarness();
    await h.render(createElement("div", null,
      createElement("button", { id: "first", "data-tooltip": "First **tip**", "aria-describedby": "original", "data-tooltip-position": "bottom", "data-tooltip-align": "start" }, createElement("span", { id: "child" }, "First")),
      createElement("button", { id: "second", "data-tooltip": "Second tip" }, "Second"),
      createElement("button", { id: "empty", "data-tooltip": " " }, "Empty"),
      createElement("select", { id: "select" }, createElement("option", null, "Option")),
      createElement(TooltipLayer)));
  });
  teardown(async () => { await h.dispose(); });
  const tooltip = () => h.dom.window.document.querySelector<HTMLElement>("[role='tooltip']");
  async function focus(selector: string) { await act(async () => { h.query<HTMLElement>(selector).focus(); }); }
  async function pointer(type: string, selector: string, options: MouseEventInit = {}, pointerType = "mouse") {
    await act(async () => {
      const event = new h.dom.window.MouseEvent(type, { bubbles: true, ...options });
      Object.defineProperty(event, "pointerType", { value: pointerType }); h.query(selector).dispatchEvent(event);
    });
  }
  async function delay() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 370)); }); }

  test("keyboard focus opens formatted content in a body portal and restores described-by", async () => {
    await focus("#first"); assert.ok(tooltip()); assert.match(tooltip()!.textContent!, /First tip/);
    assert.equal(h.query("#first").getAttribute("aria-describedby"), "webview-tooltip-layer");
    assert.equal(tooltip()!.dataset.visible, "true"); assert.match(tooltip()!.style.top, /px$/);
    await focus("#second"); assert.match(tooltip()!.textContent!, /Second/);
    assert.equal(h.query("#first").getAttribute("aria-describedby"), "original");
    await h.key("#second", "Escape"); assert.equal(tooltip(), null); assert.equal(h.query("#second").getAttribute("aria-describedby"), null);
  });

  test("hover waits for the delay, ignores nested movement and closes on pointer exit", async () => {
    await pointer("pointerover", "#first"); await pointer("pointerover", "#child"); assert.equal(tooltip(), null);
    await delay(); assert.ok(tooltip());
    await pointer("pointerover", "#first"); await pointer("pointerout", "#first", { relatedTarget: h.query("#child") }); assert.ok(tooltip());
    await pointer("pointerout", "#first", { relatedTarget: h.dom.window.document.body }); assert.equal(tooltip(), null);
  });

  test("touch, blank anchors and non-elements do not schedule tooltips", async () => {
    await pointer("pointerover", "#first", {}, "touch"); await pointer("pointerover", "#empty");
    await act(async () => { h.dom.window.document.dispatchEvent(new h.dom.window.Event("pointerover", { bubbles: true })); });
    await delay(); assert.equal(tooltip(), null);
  });

  test("pointer exit cancels an unshown tooltip", async () => {
    await pointer("pointerover", "#first"); await pointer("pointerout", "#first"); await delay(); assert.equal(tooltip(), null);
  });

  test("removing an anchor before its timer fires never creates a disconnected tooltip", async () => {
    await pointer("pointerover", "#first"); h.query("#first").remove(); await delay(); assert.equal(tooltip(), null);
  });

  test("live text mutations update the tooltip and empty text releases it", async () => {
    await focus("#second");
    await act(async () => { h.query("#second").setAttribute("data-tooltip", "Changed text"); });
    assert.equal(tooltip()!.textContent, "Changed text");
    await act(async () => { h.query("#second").setAttribute("data-tooltip", "Changed text"); });
    assert.equal(tooltip()!.textContent, "Changed text");
    await act(async () => { h.query("#second").setAttribute("data-tooltip", " "); }); assert.equal(tooltip(), null);
  });

  test("resize, scroll and removal of the active anchor update or close placement", async () => {
    await focus("#first");
    await act(async () => { window.dispatchEvent(new h.dom.window.Event("resize")); window.dispatchEvent(new h.dom.window.Event("scroll")); });
    assert.equal(tooltip()!.dataset.visible, "true");
    h.query("#first").remove(); await act(async () => { window.dispatchEvent(new h.dom.window.Event("resize")); }); assert.equal(tooltip(), null);
  });

  for (const event of ["pointerdown", "click", "blur"] as const) {
    test(`${event} closes an open tooltip without overwriting a changed ARIA owner`, async () => {
      await focus("#second"); h.query("#second").setAttribute("aria-describedby", "new-owner");
      await act(async () => { (event === "blur" ? h.dom.window : h.dom.window.document).dispatchEvent(new h.dom.window.Event(event, { bubbles: true })); });
      assert.equal(tooltip(), null); assert.equal(h.query("#second").getAttribute("aria-describedby"), "new-owner");
    });
  }

  test("focus leaving an anchor and keys inside selects close the tooltip", async () => {
    await focus("#first"); await focus("#empty"); assert.equal(tooltip(), null);
    await focus("#second"); await h.key("#select", "ArrowDown"); assert.equal(tooltip(), null);
    await h.key("#empty", "a"); assert.equal(tooltip(), null);
    await pointer("pointerout", "#empty"); assert.equal(tooltip(), null);
  });
});

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import type { ComponentProps } from "react";
import NumberInput from "@webview/components/settingsView/numberInput/NumberInput";
import { createDomHarness } from "../../../support/DomHarness";

suite("settings numeric input controls", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let changes: string[];
  setup(async () => {
    h = await createDomHarness(); changes = [];
    const prototype = h.dom.window.HTMLInputElement.prototype;
    const up = prototype.stepUp; const down = prototype.stepDown;
    // jsdom's stepUp rejects a negative delta; route that case through its native stepDown.
    prototype.stepUp = function (count = 1) { if (count < 0) { down.call(this, -count); } else { up.call(this, count); } };
  });
  teardown(async () => { await h.dispose(); });
  function Controlled(props: ComponentProps<typeof NumberInput>) {
    const [value, setValue] = useState(String(props.value ?? 2));
    return createElement(NumberInput, { ...props, id: "numeric", value, onInput: event => { const next = event.currentTarget.value; changes.push(next); setValue(next); } });
  }
  const increase = ".numberInputControls button:first-child"; const decrease = ".numberInputControls button:last-child";
  test("steps controlled values, focuses the field and disables buttons at numeric limits", async () => {
    await h.render(createElement(Controlled, { min: 1, max: 3, step: 1, value: 2 }));
    await h.click(increase); assert.equal(h.query<HTMLInputElement>("input").value, "3"); assert.equal(h.query<HTMLButtonElement>(increase).disabled, true);
    assert.equal(h.dom.window.document.activeElement, h.query("input"));
    await h.click(decrease); await h.click(decrease);
    assert.deepEqual(changes, ["3", "2", "1"], JSON.stringify(changes)); assert.equal(h.query<HTMLButtonElement>(decrease).disabled, true);
    await h.click(decrease); assert.equal(changes.length, 3);
  });
  for (const state of ["disabled", "readOnly"] as const) {
    test(`leaves ${state} fields unchanged`, async () => {
      await h.render(createElement(Controlled, { [state]: true, value: 2 }));
      assert.equal(h.query<HTMLButtonElement>(increase).disabled, true); assert.equal(h.query<HTMLButtonElement>(decrease).disabled, true);
      await h.click(increase); await h.click(decrease); assert.deepEqual(changes, []);
      assert.equal(h.query<HTMLInputElement>("input").value, "2");
    });
  }
  test("supports unconstrained stepping and prevents mouse-down focus changes on both controls", async () => {
    await h.render(createElement(Controlled, { step: 0.5, value: 2 }));
    for (const selector of [increase, decrease]) {
      const event = new h.dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
      await act(async () => { h.query(selector).dispatchEvent(event); }); assert.equal(event.defaultPrevented, true);
    }
    await h.click(increase); await h.click(decrease); assert.deepEqual(changes, ["2.5", "2"], JSON.stringify(changes));
  });
  test("does not emit an input event if native stepping cannot change the value", async () => {
    await h.render(createElement(NumberInput, { defaultValue: 2, max: 2, onInput: () => { changes.push("changed"); } }));
    assert.equal(h.query<HTMLButtonElement>(increase).disabled, false);
    await h.click(increase); assert.equal(h.query<HTMLInputElement>("input").value, "2"); assert.deepEqual(changes, []);
  });
});

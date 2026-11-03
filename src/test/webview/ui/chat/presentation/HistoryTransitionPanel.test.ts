import assert from "node:assert/strict";
import { createElement } from "react";
import Panel, { type HistoryTransition } from "@webview/components/shared/historyTransitionPanel/HistoryTransitionPanel";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

suite("history transition decision panel", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let decisions: string[];
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); decisions = []; });
  teardown(async () => { await h.dispose(); });
  const render = (transition: HistoryTransition | null) => h.render(createElement(Panel, { transition, onDecision: decision => { decisions.push(decision); } }));
  test("renders nothing when no transition is pending", async () => { await render(null); assert.equal(h.container.querySelector("[role=dialog]"), null); });
  for (const direction of ["enter-incognito", "exit-incognito"] as const) {
    for (const [activeGenerations, queuedMessages] of [[0, 0], [1, 0], [0, 2]]) {
      test(`offers stop or continue for ${direction}, active=${activeGenerations}, queued=${queuedMessages}`, async () => {
        await render({ type: "historyTransitionRequired", requestId: "transition", phase: "stop-work", direction, activeGenerations, queuedMessages });
        const hasWork = activeGenerations + queuedMessages > 0;
        assert.equal(Boolean(h.container.querySelector(".historyTransitionNotice.warning")), hasWork);
        assert.equal(h.query("h3").textContent, direction === "enter-incognito" ? "Enter incognito mode?" : "Stop incognito work before leaving?");
        if (hasWork) { assert.match(h.query(".historyTransitionNotice p").textContent ?? "", new RegExp(`${queuedMessages} queued messages`)); }
        await h.click(".historyTransitionAction.primary"); await h.click(".historyTransitionActions button:last-child");
        await h.key("[role=dialog]", "Escape"); assert.deepEqual(decisions, ["stop", "cancel", "cancel"]);
      });
    }
  }
  test("offers independent save, discard and cancel choices when leaving incognito", async () => {
    await render({ type: "historyTransitionRequired", requestId: "transition", phase: "exit-incognito", direction: "exit-incognito", activeGenerations: 0, queuedMessages: 0 });
    assert.equal(h.query("h3").textContent, "Leave incognito mode?");
    for (const button of h.container.querySelectorAll<HTMLButtonElement>("button")) { await h.click(button); }
    assert.deepEqual(decisions, ["save", "discard", "cancel"]);
  });
});

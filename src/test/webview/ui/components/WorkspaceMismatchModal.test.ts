import assert from "node:assert/strict";
import { act, createElement } from "react";
import WorkspaceMismatchModal from "@/ui/components/shared/workspaceMismatchModal/WorkspaceMismatchModal";
import { createDomHarness } from "../../../support/DomHarness";

suite("workspace mismatch confirmation behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let confirmed: number; let cancelled: number;
  setup(async () => { h = await createDomHarness(); confirmed = 0; cancelled = 0; });
  teardown(async () => { await h.dispose(); });
  async function render() {
    await h.render(createElement(WorkspaceMismatchModal, { workspaceName: "Other workspace <project>", onConfirm: () => { confirmed++; }, onCancel: () => { cancelled++; } }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
  test("shows the workspace name as text, labels the dialog and focuses confirmation", async () => {
    await render(); const dialog = h.query('[role="dialog"]');
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.ok(document.getElementById(dialog.getAttribute("aria-labelledby")!));
    assert.match(document.getElementById(dialog.getAttribute("aria-describedby")!)!.textContent!, /Other workspace <project>/);
    assert.equal(h.container.querySelector("project"), null); assert.equal(document.activeElement, h.query(".primary"));
    await h.click(".primary"); assert.equal(confirmed, 1); assert.equal(cancelled, 0);
  });
  test("cancel and Escape invoke cancellation without confirming", async () => {
    await render(); await h.click(".workspaceMismatchAction:not(.primary)"); assert.equal(cancelled, 1);
    await h.key('[role="dialog"]', "Escape"); assert.equal(cancelled, 2); assert.equal(confirmed, 0);
  });
});

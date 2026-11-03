import assert from "node:assert/strict";
import { act, createElement } from "react";
import StorageSection from "@/ui/views/settingsView/sections/StorageSection";
import { createDomHarness } from "../../../support/DomHarness";

suite("storage settings rendered behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let saved: string[]; let browsed: number; let reloads: number;
  const info = { directory: "/active", configuredDirectory: "/active", defaultDirectory: "/default" };
  setup(async () => { h = await createDomHarness(); saved = []; browsed = 0; reloads = 0; });
  teardown(async () => { await h.dispose(); });
  async function render(patch: Partial<Parameters<typeof StorageSection>[0]> = {}) {
    await h.render(createElement(StorageSection, { info, pending: false, onSave: (value) => { saved.push(value); }, onBrowse: () => { browsed++; }, onReload: () => { reloads++; }, ...patch }));
  }
  async function blur(relatedTarget: Element | null = null) {
    await act(async () => { h.query("input").dispatchEvent(new h.dom.window.FocusEvent("focusout", { bubbles: true, relatedTarget })); });
  }
  test("saves a trimmed edited directory on blur and ignores blank or unchanged values", async () => {
    await render(); assert.equal(h.query<HTMLInputElement>("input").value, "/active");
    await h.input("input", " /new "); await blur(); assert.deepEqual(saved, ["/new"]);
    await h.input("input", "  "); await blur(); await h.input("input", "/active"); await blur(); assert.deepEqual(saved, ["/new"]);
    assert.equal(h.query("input").getAttribute("aria-describedby"), null);
  });
  test("Enter blurs the input and saves while other keys leave editing active", async () => {
    await render(); await act(async () => { h.query<HTMLInputElement>("input").focus(); });
    await h.input("input", "/entered"); await h.key("input", "a"); assert.deepEqual(saved, []);
    await h.key("input", "Enter"); assert.deepEqual(saved, ["/entered"]);
  });
  test("browse and default controls do not save an unfinished draft on focus transfer", async () => {
    await render(); await h.input("input", "/unfinished");
    await blur(h.query(".storageBrowse i")); await blur(h.query(".storageDefault")); assert.deepEqual(saved, []);
    await h.click(".storageBrowse"); assert.equal(browsed, 1); await h.click(".storageDefault");
    assert.deepEqual(saved, ["/default"]); assert.equal(h.query<HTMLInputElement>("input").value, "/default");
  });
  test("pending settings disable edits, save, browse, default and reload", async () => {
    await render({ pending: true, info: { ...info, configuredDirectory: "/next" } });
    assert.ok(h.query<HTMLInputElement>("input").disabled); await h.input("input", "/draft"); await blur();
    for (const button of h.container.querySelectorAll<HTMLButtonElement>("button")) { assert.ok(button.disabled); await h.click(button); }
    assert.deepEqual(saved, []); assert.equal(browsed, 0); assert.equal(reloads, 0);
  });
  test("reload guidance and errors have the expected accessible relationships", async () => {
    await render({ info: { ...info, configuredDirectory: "/next" } }); assert.equal(h.query("input").getAttribute("aria-describedby"), "storageReloadHint");
    await h.click(".storageReload button"); assert.equal(reloads, 1);
    await render({ error: "permission denied", info: { ...info, configuredDirectory: "/next" } });
    assert.match(h.query('[role="alert"]').textContent!, /permission denied/); assert.equal(h.query("input").getAttribute("aria-describedby"), "storageError");
    await render({ info: { ...info, configuredDirectory: "/confirmed", directory: "/confirmed" } });
    assert.equal(h.query<HTMLInputElement>("input").value, "/confirmed"); assert.equal(h.container.querySelector(".storageReload"), null);
  });
});

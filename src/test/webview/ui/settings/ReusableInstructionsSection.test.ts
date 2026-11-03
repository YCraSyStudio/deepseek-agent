import assert from "node:assert/strict";
import { act, createElement } from "react";
import ReusableInstructionsSection from "@/ui/views/settingsView/sections/ReusableInstructionsSection";
import type { ReusableInstruction } from "@/contracts/Customization";
import { createDomHarness } from "../../../support/DomHarness";

suite("reusable instructions rendered workflow", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  const roots = [{ uri: "file:///workspace", name: "Project", exists: true }];
  setup(async () => { h = await createDomHarness(); });
  teardown(async () => { await h.dispose(); });
  async function render(selectedRoots: typeof roots | null = roots) { await h.render(createElement(ReusableInstructionsSection, { roots: selectedRoots })); }
  async function open() { await h.click(".settingsGroup > button"); }
  async function submit() { await act(async () => { h.query("form").dispatchEvent(new h.dom.window.Event("submit", { bubbles: true, cancelable: true })); }); }
  async function fill() { await h.input("#reusableInstructionName", " review "); await h.input("#reusableInstructionDescription", " Review the change "); }
  async function result(success: boolean, error?: string, requestId = h.last("createReusableInstruction").requestId) {
    await h.message({ type: "reusableInstructionResult", requestId, success, error });
  }
  const entries: ReusableInstruction[] = [
    { id: "global", name: "global", description: "Global guide", scope: "global" },
    { id: "workspace", name: "project", description: "Project guide", scope: "workspace", rootUri: roots[0].uri },
    { id: "missing", name: "missing", description: "Other guide", scope: "workspace", rootUri: "file:///other" },
  ];
  test("requests entries, displays loading and groups global and workspace instructions", async () => {
    await render(); assert.equal(h.last("getReusableInstructions").type, "getReusableInstructions"); assert.ok(h.container.querySelector('[role="status"]'));
    await h.message({ type: "reusableInstructions", entries });
    assert.equal(h.container.querySelector('[role="status"]'), null);
    assert.deepEqual([...h.container.querySelectorAll(".settingsDisclosureCount")].map((element) => element.textContent), ["1", "2"]);
    for (const summary of h.container.querySelectorAll<HTMLElement>("summary")) { await h.click(summary); }
    assert.match(h.query(".reusableInstructionList").textContent!, /global.md/);
    assert.match(h.container.textContent!, /Project/); assert.equal(h.container.querySelectorAll(".reusableInstructionItem").length, 3);
    await h.message({ type: "reusableInstructions", entries: [], error: "scan failed" }); assert.equal(h.container.querySelectorAll(".reusableInstructionItem").length, 0); assert.equal(h.query('[role="alert"]').textContent, "scan failed");
  });
  test("validates blank description and invalid names even on direct form submission", async () => {
    await render(); await open(); assert.ok(h.query<HTMLButtonElement>('[type="submit"]').disabled); await submit();
    await h.input("#reusableInstructionDescription", "description"); await h.input("#reusableInstructionName", "../invalid"); await submit();
    assert.equal(h.posts.filter((post) => post.type === "createReusableInstruction").length, 0);
    await h.input("#reusableInstructionName", "valid"); await h.input("#reusableInstructionDescription", "   "); await submit();
    assert.ok(h.query<HTMLButtonElement>('[type="submit"]').disabled);
  });
  test("creates a trimmed global instruction, prevents duplicate submissions and resets after correlated success", async () => {
    await render(); await open(); await fill(); await submit(); const post = h.last("createReusableInstruction");
    assert.equal(post.scope, "global"); assert.equal(post.rootUri, undefined); assert.equal(post.name, "review"); assert.equal(post.description, "Review the change"); assert.equal(post.template, "blank"); assert.equal(typeof post.requestId, "string");
    await submit(); assert.equal(h.posts.filter((message) => message.type === "createReusableInstruction").length, 1);
    for (const control of h.container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) { assert.ok(control.disabled); }
    await result(true, undefined, "stale"); assert.ok(h.container.querySelector("form"));
    await result(true); assert.equal(h.container.querySelector("form"), null); await open();
    assert.equal(h.query<HTMLInputElement>("#reusableInstructionName").value, "blank"); assert.equal(h.query<HTMLInputElement>("#reusableInstructionDescription").value, "");
  });
  test("keeps failed creation editable and clears the error when retried", async () => {
    await render(); await open(); await fill(); await submit(); await result(false, "disk full");
    assert.equal(h.query('[role="alert"]').textContent, "disk full"); assert.equal(h.query<HTMLInputElement>("#reusableInstructionName").value, " review ");
    assert.equal(h.query<HTMLButtonElement>('[type="submit"]').disabled, false); await submit(); assert.equal(h.container.querySelector('[role="alert"]'), null);
  });
  test("selects templates and scopes creation to the workspace", async () => {
    await render(); await open();
    for (const template of ["git", "commit"]) {
      await h.input("#reusableInstructionTemplate", template); assert.equal(h.query<HTMLInputElement>("#reusableInstructionName").value, template); assert.ok(h.query<HTMLInputElement>("#reusableInstructionDescription").value.length > 0);
    }
    const unsupported = document.createElement("option"); unsupported.value = "unsupported"; unsupported.textContent = "Unsupported";
    h.query("#reusableInstructionTemplate").appendChild(unsupported);
    await h.input("#reusableInstructionTemplate", "unsupported"); assert.equal(h.query<HTMLInputElement>("#reusableInstructionName").value, "commit");
    await h.input("#reusableInstructionScope", roots[0].uri); await submit(); const post = h.last("createReusableInstruction");
    assert.equal(post.template, "commit"); assert.equal(post.scope, "workspace"); assert.equal(post.rootUri, roots[0].uri);
  });
  test("falls back to global scope when the selected workspace disappears", async () => {
    await render(); await open(); await fill(); await h.input("#reusableInstructionScope", roots[0].uri); await render([]);
    assert.equal(h.query<HTMLSelectElement>("#reusableInstructionScope").value, "global"); await submit(); assert.equal(h.last("createReusableInstruction").scope, "global");
  });
  test("cancel closes the form and opening creation clears an earlier scan error", async () => {
    await render(null); await h.message({ type: "reusableInstructions", entries: [], error: "scan error" }); await open(); assert.equal(h.container.querySelector('[role="alert"]'), null);
    await h.click('.reusableInstructionActions [type="button"]'); assert.equal(h.container.querySelector("form"), null);
  });
  test("opens existing instructions through correlated host requests", async () => {
    await render(null); await h.message({ type: "reusableInstructions", entries });
    for (const summary of h.container.querySelectorAll<HTMLElement>("summary")) { await h.click(summary); }
    await h.click(".reusableInstructionItem"); const post = h.last("openReusableInstruction"); assert.equal(post.id, "global");
    assert.ok(h.query<HTMLButtonElement>(".reusableInstructionItem").disabled);
    await result(false, "file missing", post.requestId); assert.equal(h.query('[role="alert"]').textContent, "file missing"); assert.equal(h.query<HTMLButtonElement>(".reusableInstructionItem").disabled, false);
    await h.click(".reusableInstructionItem"); await result(true, undefined, h.last("openReusableInstruction").requestId); assert.equal(h.container.querySelector('[role="alert"]'), null);
  });
});

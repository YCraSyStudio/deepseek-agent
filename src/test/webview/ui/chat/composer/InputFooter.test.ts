import assert from "node:assert/strict";
import { act, createElement, type ComponentProps } from "react";
import InputFooter from "@/ui/views/chatView/sections/inputArea/inputFooter/InputFooter";
import { createUsageAggregate } from "@/shared/usage/Usage";
import { setInterfaceLanguage } from "@/ui/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

type Props = ComponentProps<typeof InputFooter>;
suite("composer footer responsive controls", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let permissions: string[]; let models: string[]; let reasoning: string[]; let removed: number[];
  let callbacks: ResizeObserverCallback[]; let disconnected: number; let originalObserver: typeof ResizeObserver;
  setup(async () => {
    h = await createDomHarness(); setInterfaceLanguage("en"); permissions = []; models = []; reasoning = []; removed = []; callbacks = []; disconnected = 0;
    originalObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(callback: ResizeObserverCallback) { callbacks.push(callback); } observe() {} unobserve() {} disconnect() { disconnected++; } } as typeof ResizeObserver;
  });
  teardown(async () => { await h.dispose(); globalThis.ResizeObserver = originalObserver; });
  async function render(patch: Partial<Props> = {}, wrapper = true) {
    const footer = createElement(InputFooter, { selectedModel: "deepseek-flash", reasoning: "off", permissionMode: "default", onModelChange: (value) => { models.push(value); }, onReasoningChange: (value) => { reasoning.push(value); }, onPermissionModeChange: (value) => { permissions.push(value); }, ...patch });
    await h.render(wrapper ? createElement("div", { className: "inputComposer" }, footer) : footer);
  }
  async function width(value: number) { await act(async () => { callbacks[0]([{ contentRect: { width: value } } as ResizeObserverEntry], {} as ResizeObserver); }); }
  test("attachment selection includes conversation identity and a new request identifier", async () => {
    await render({ conversationId: "chat" }); await h.click(".attachmentPickerTrigger"); const request = h.last("selectAttachments"); assert.equal(request.conversationId, "chat"); assert.equal(typeof request.requestId, "string");
  });
  test("wide permission selector returns only supported modes and respects pending state", async () => {
    await render(); for (const value of ["auto-approve", "full-access", "default"]) { await h.input("#PermissionMode", value); } assert.deepEqual(permissions, ["auto-approve", "full-access", "default"]);
    const option = document.createElement("option"); option.value = "unsupported"; h.query("#PermissionMode").appendChild(option); await h.input("#PermissionMode", "unsupported"); assert.equal(permissions.length, 3);
    await render({ permissionUpdatePending: true }); assert.ok(h.query<HTMLSelectElement>("#PermissionMode").disabled); assert.equal(h.query("#PermissionMode").getAttribute("aria-busy"), "true");
  });
  test("reference chips preserve file labels, size warnings and removal indexes", async () => {
    await render({ referencedFiles: [{ path: "./directory", type: "directory", size: 1048577 }, { path: "./file.ts", name: "file.ts", type: "file", size: 10 }], onRemoveReferencedFile: (index) => { removed.push(index); } });
    assert.match(h.query(".fileChip").textContent!, /directory/); assert.ok(h.container.querySelector(".fileChipWarn"));
    await h.click(h.container.querySelectorAll<HTMLButtonElement>(".fileChipRemove")[1]); assert.deepEqual(removed, [1]);
    await render({ referencedFiles: [{ path: "./file", type: "file" }] }); await h.click(".fileChipRemove"); assert.deepEqual(removed, [1]);
  });
  test("unknown model IDs remain selectable and visible", async () => {
    await render({ selectedModel: "custom-model" }); assert.match(h.query(".modelReasoningTrigger").textContent!, /custom-model/); await h.click(".modelReasoningTrigger"); assert.match(h.query('[role="menu"]').textContent!, /custom-model/);
  });
  test("narrow composers move permission options into the compact menu and disconnect on unmount", async () => {
    await render(); await width(440); assert.equal(h.container.querySelector("#PermissionMode"), null); assert.ok(h.container.querySelector(".compactComposerPicker"));
    await h.click(".modelReasoningTrigger"); const option = [...h.container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) => /Full access/i.test(button.textContent!)); assert.ok(option); await h.click(option); assert.deepEqual(permissions, ["full-access"]);
    await width(441); assert.ok(h.container.querySelector("#PermissionMode")); await h.render(createElement("div")); assert.equal(disconnected, 1);
  });
  test("works without an enclosing composer", async () => {
    await render({}, false); assert.equal(callbacks.length, 0); assert.ok(h.container.querySelector("#PermissionMode"));
  });
  test("wide and narrow usage displays share the measured aggregate", async () => {
    const usage = createUsageAggregate(true); usage.count = 1; usage.requests = 1;
    await render({ showUsage: true, usage }); assert.ok(h.container.querySelector(".usageTrigger"));
    await width(400); assert.equal(h.container.querySelector(".usageTrigger"), null); await h.click(".modelReasoningTrigger"); assert.ok(h.container.querySelector(".compactComposerUsage"));
    await render({ showUsage: true, usage: createUsageAggregate(true) }); assert.equal(h.container.querySelector(".compactComposerUsage"), null);
    await render({ showUsage: false, usage }); assert.equal(h.container.querySelector(".compactComposerUsage"), null);
  });
  test("suggestion button switches between request and cancellation without stealing focus", async () => {
    let requests = 0; let cancels = 0; const suggestions = { visible: true, disabled: false, pending: false, request: () => { requests++; }, cancel: () => { cancels++; } };
    await render({ suggestions }); const down = new h.dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }); await act(async () => { h.query(".chatSuggestionTrigger").dispatchEvent(down); }); assert.ok(down.defaultPrevented);
    await h.click(".chatSuggestionTrigger"); assert.equal(requests, 1); await render({ suggestions: { ...suggestions, pending: true } }); assert.equal(h.query(".chatSuggestionTrigger").getAttribute("aria-busy"), "true");
    await h.click(".chatSuggestionTrigger"); assert.equal(cancels, 1); await render({ suggestions: { ...suggestions, disabled: true } }); await h.click(".chatSuggestionTrigger"); assert.equal(requests, 1);
    await render({ suggestions: { ...suggestions, visible: false } }); assert.equal(h.container.querySelector(".chatSuggestionTrigger"), null);
  });
});

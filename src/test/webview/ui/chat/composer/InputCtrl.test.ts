import assert from "node:assert/strict";
import { act, createElement, useState, type ComponentProps } from "react";
import InputCtrl from "@/ui/views/chatView/sections/inputArea/inputCtrl/InputCtrl";
import { VsCodeContext } from "@/ui/views/chatView/contexts/VsCodeContext";
import { t } from "@/ui/i18n";
import type { VsCodeApi } from "@/ui/VsCodeApi";
import { DEFAULT_CONFIG, type ImageAttachment } from "@/contracts";
import { createDomHarness } from "../../../../support/DomHarness";

type Props = ComponentProps<typeof InputCtrl>;
suite("composer input observable behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let sent: unknown[][]; let errors: string[]; let host: VsCodeApi;
  let previews: Parameters<NonNullable<Props["onPendingImage"]>>[0][]; let removed: unknown[];
  let originalObjectUrl: typeof URL.createObjectURL;
  const image: ImageAttachment = { id: "image", fileId: "file-api-image", name: "image.png", mediaType: "image/png", size: 10, source: "picker", uploadedAt: 1, expiresAt: 2, apiBaseUrl: "https://api.deepseek.com", cacheFileName: "image.png", previewUri: "https://webview.test/image.png" };
  setup(async () => {
    h = await createDomHarness(); sent = []; errors = []; previews = []; removed = [];
    host = { postMessage: (message) => { h.posts.push(message as Record<string, unknown>); }, getState: () => undefined, setState: (state) => state };
    originalObjectUrl = URL.createObjectURL; URL.createObjectURL = () => "blob:preview";
  });
  teardown(async () => { URL.createObjectURL = originalObjectUrl; await h.dispose(); });
  function Composer({ patch, connected }: { patch: Partial<Props>; connected: boolean }) {
    const [input, setInput] = useState(patch.input ?? " hello ");
    return createElement(VsCodeContext.Provider, { value: connected ? host : null }, createElement(InputCtrl, {
      selectedModelRef: { current: "deepseek-chat" }, reasoningRef: { current: "enabled" }, conversationId: "chat", workspaceRevision: "revision",
      onSend: (...args) => { sent.push(args); }, onImagePasteError: (error) => { errors.push(error); }, onPendingImage: (preview) => { previews.push(preview); },
      onRemovePendingImage: (id) => { removed.push(id); }, onRemoveImageAttachment: (attachment) => { removed.push(attachment); },
      ...patch, input, setInput,
    }));
  }
  async function render(patch: Partial<Props> = {}, connected = true) { await h.render(createElement(Composer, { patch, connected })); }
  async function paste(items: Array<{ kind: string; type: string; getAsFile(): File | null }>) {
    const event = new h.dom.window.Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { items } });
    await act(async () => { h.query("textarea").dispatchEvent(event); }); return event;
  }
  function clipboard(type = "image/png", name = "photo.png", size = 5) {
    const file = new h.dom.window.File([new Uint8Array(size)], name, { type }); return { kind: "file", type, getAsFile: () => file };
  }

  test("sends trimmed text with model, reasoning, workspace and restricted reference payloads", async () => {
    await render({ referencedFiles: [{ path: "./a.ts", name: "a", content: "source", type: "file", scope: "workspace", rootUri: "file:///workspace", bindingRevision: "3", referenceId: "ref" }] });
    await h.click(".sendBtn"); const post = h.last("sendMessage");
    assert.equal(post.text, "hello"); assert.equal(post.modelId, "deepseek-chat"); assert.equal(post.reasoning, "enabled"); assert.equal(post.conversationId, "chat"); assert.equal(post.workspaceRevision, "revision");
    assert.deepEqual(post.referencedFiles, [{ path: "./a.ts", content: "source", type: "file", scope: "workspace", rootUri: "file:///workspace", bindingRevision: "3", referenceId: "ref" }]);
    assert.deepEqual(sent, [["hello", post.clientRequestId, []]]); assert.equal(typeof post.clientRequestId, "string");
    await h.click("textarea"); assert.equal(h.query<HTMLTextAreaElement>("textarea").value, " hello ");
  });
  test("empty, disconnected and disabled composers do not submit", async () => {
    await render({ input: "  " }); await h.click(".sendBtn"); await h.key("textarea", "Enter"); assert.deepEqual(sent, []);
    await render({}, false); await h.click(".sendBtn"); assert.deepEqual(sent, []);
    await render({ canSend: false }); await h.click(".sendBtn"); await h.key("textarea", "Enter"); assert.deepEqual(sent, []);
  });
  test("Enter sends, Shift-Enter and composing Enter preserve editing", async () => {
    await render(); await h.key("textarea", "Enter", { shiftKey: true }); await h.key("textarea", "Enter", { isComposing: true }); assert.deepEqual(sent, []);
    await h.key("textarea", "Enter"); assert.equal(sent.length, 1);
  });
  test("processing Enter steers the active generation while Ctrl-Enter queues a message", async () => {
    await render({ isProcessing: true, activeGenerationId: "generation" }); await h.key("textarea", "Enter");
    assert.equal(h.last("steerGeneration").generationId, "generation"); assert.equal(h.last("steerGeneration").text, "hello");
    await h.key("textarea", "Enter", { ctrlKey: true }); assert.equal(h.last("sendMessage").text, "hello"); assert.equal(sent.length, 2);
  });
  test("processing action steers, switches to queue while Control is pressed and resets on window blur", async () => {
    await render({ isProcessing: true, activeGenerationId: "generation" }); await h.click(".sendBtn"); assert.equal(h.last("steerGeneration").generationId, "generation");
    await h.key("textarea", "Control", { ctrlKey: true }); assert.ok(h.container.querySelector(".codicon-list-ordered")); await h.click(".sendBtn"); assert.ok(h.last("sendMessage"));
    await act(async () => { window.dispatchEvent(new h.dom.window.Event("blur")); }); assert.ok(h.container.querySelector(".codicon-debug-restart"));
  });
  test("an empty processing composer cancels only the identified generation", async () => {
    await render({ input: "", isProcessing: true, activeGenerationId: "generation" }); await h.click(".stopBtn");
    assert.equal(h.last("cancelGeneration").generationId, "generation"); assert.equal(h.last("cancelGeneration").conversationId, "chat"); assert.deepEqual(sent, []);
    await render({ input: "", isProcessing: true }); await h.click(".stopBtn"); assert.equal(h.posts.filter((post) => post.type === "cancelGeneration").length, 1);
  });
  test("does not steer without both conversation and generation identifiers", async () => {
    await render({ isProcessing: true }); await h.key("textarea", "Enter");
    await render({ isProcessing: true, activeGenerationId: "generation", conversationId: undefined }); await h.click(".sendBtn"); assert.deepEqual(sent, []);
  });
  test("submits image-only messages and combines uploaded and selected images", async () => {
    await render({ input: "", imageAttachments: [image], pendingImages: [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }], onPrepareImages: async () => [{ ...image, id: "uploaded" }] });
    await h.click(".sendBtn"); assert.equal(h.last("sendMessage").text, ""); assert.deepEqual((h.last("sendMessage").imageAttachments as ImageAttachment[]).map((item) => item.id), ["image", "uploaded"]);
  });
  test("prevents duplicate sends while image preparation is pending", async () => {
    let complete!: (images: ImageAttachment[]) => void; const ready = new Promise<ImageAttachment[]>((resolve) => { complete = resolve; });
    await render({ pendingImages: [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }], onPrepareImages: () => ready });
    await h.click(".sendBtn"); await h.click(".sendBtn"); assert.deepEqual(sent, []);
    await act(async () => { complete([image]); await ready; }); assert.equal(sent.length, 1);
  });
  test("reports image preparation failures for both send and steer and permits retry", async () => {
    const pendingImages = [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }];
    await render({ pendingImages, onPrepareImages: async () => { throw new Error("upload failed"); } }); await h.click(".sendBtn");
    await render({ pendingImages, isProcessing: true, activeGenerationId: "generation", onPrepareImages: async () => { throw "upload rejected"; } }); await h.click(".sendBtn");
    await render({ pendingImages, onPrepareImages: async () => { throw "send rejected"; } }); await h.click(".sendBtn");
    assert.deepEqual(errors, ["upload failed", "upload rejected", "send rejected"]); assert.deepEqual(sent, []);
    await render({ pendingImages, onPrepareImages: async () => [] }); await h.click(".sendBtn"); assert.equal(sent.length, 1);
  });
  test("does not send when the component unmounts during image preparation", async () => {
    let complete!: (images: ImageAttachment[]) => void; const ready = new Promise<ImageAttachment[]>((resolve) => { complete = resolve; });
    await render({ pendingImages: [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }], onPrepareImages: () => ready }); await h.click(".sendBtn"); await h.render(createElement("div"));
    await act(async () => { complete([image]); await ready; }); assert.deepEqual(sent, []); assert.equal(h.posts.some((post) => post.type === "sendMessage"), false);
  });
  test("pastes image files into local previews and leaves ordinary clipboard content alone", async () => {
    await render(); assert.equal((await paste([{ kind: "string", type: "text/plain", getAsFile: () => null }])).defaultPrevented, false);
    assert.equal((await paste([{ kind: "file", type: "image/png", getAsFile: () => null }])).defaultPrevented, false);
    assert.equal((await paste([clipboard()])).defaultPrevented, true); assert.equal(previews[0].name, "photo.png"); assert.equal(previews[0].previewUri, "blob:preview"); assert.ok(previews[0].file);
    assert.equal(h.posts.some((post) => post.type === "uploadClipboardImage"), false);
  });
  for (const [mime, extension] of [["image/jpeg", "jpg"], ["image/gif", "gif"], ["image/webp", "webp"], ["image/png", "png"]]) {
    test(`generates a filename for nameless ${mime} clipboard images`, async () => {
      await render(); await paste([clipboard(mime, "")]); assert.ok(previews[0].name.endsWith(`.${extension}`));
    });
  }
  test("rejects too many, empty and oversized pasted images", async () => {
    await render(); await paste(Array.from({ length: 9 }, () => clipboard())); assert.match(errors[0], /at most 8/);
    await paste([clipboard("image/png", "empty", 0), clipboard("image/png", "big", 16 * 1024 * 1024 + 1)]); assert.equal(errors.length, 3); assert.equal(previews.length, 0);
  });
  test("path suggestions take keyboard priority over sending and expose the active option", async () => {
    await render(); await h.input("textarea", "./s");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 165)); });
    await h.message({ type: "pathCompletions", requestId: h.last("getPathCompletions").requestId, workspaceRevision: "revision", query: "./s", items: [
      { type: "file", path: "./src/a.ts", label: "a.ts" }, { type: "file", path: "./src/b.ts", label: "b.ts" },
    ] });
    assert.equal(h.query("textarea").getAttribute("aria-expanded"), "true");
    await h.key("textarea", "ArrowUp"); assert.equal(h.query("textarea").getAttribute("aria-activedescendant"), "path-completion-option-1");
    await h.key("textarea", "ArrowDown"); assert.equal(h.query("textarea").getAttribute("aria-activedescendant"), "path-completion-option-0");
    await h.key("textarea", "Tab"); assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "./src/a.ts"); assert.deepEqual(sent, []);
  });
  test("Escape dismisses path completions, including empty responses", async () => {
    await render(); await h.input("textarea", "./s");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 165)); });
    const requestId = h.last("getPathCompletions").requestId;
    await h.message({ type: "pathCompletions", requestId, workspaceRevision: "revision", query: "./s", items: [] });
    assert.equal(h.query('.srOnly[role="status"]').textContent, t("chat.noFilesOrFoldersFound"));
    await h.message({ type: "pathCompletions", requestId, workspaceRevision: "revision", query: "./s", items: [{ type: "file", path: "./src/a.ts", label: "a.ts" }] });
    await h.key("textarea", "Escape"); assert.equal(h.query("textarea").getAttribute("aria-expanded"), "false"); assert.deepEqual(sent, []);
  });
  test("explicit ghost suggestions can be accepted with Tab or dismissed with Escape", async () => {
    await render({ footer: (controls) => createElement("button", { className: "suggest", onClick: controls.request }, "Suggest") });
    await h.message({ type: "configLoaded", revision: 1, config: { ...DEFAULT_CONFIG, betaFeaturesEnabled: true, chatSuggestionsEnabled: true } });
    await h.message({ type: "apiKeyStatus", status: "configured" }); await h.click(".suggest");
    await h.message({ type: "chatSuggestion", requestId: h.last("getChatSuggestion").requestId, text: "world" });
    assert.equal(h.query("textarea").getAttribute("aria-autocomplete"), "both"); await h.key("textarea", "Tab");
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, " hello world"); assert.deepEqual(sent, []);
    await h.click(".suggest"); await h.message({ type: "chatSuggestion", requestId: h.last("getChatSuggestion").requestId, text: " more" });
    await h.key("textarea", "Escape"); assert.equal(h.query("textarea").getAttribute("aria-autocomplete"), "list");
    await h.click(".suggest"); await h.message({ type: "chatSuggestion", requestId: h.last("getChatSuggestion").requestId, text: "" }); assert.ok(h.container.querySelector(".chatSuggestionNotice"));
  });
  test("pasted images without a host do not create upload previews", async () => {
    await render({}, false); await paste([clipboard()]); assert.deepEqual(previews, []);
  });
  test("pending image preparation is optional for send and steer", async () => {
    const pendingImages = [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }];
    await render({ pendingImages }); await h.click(".sendBtn"); assert.deepEqual(h.last("sendMessage").imageAttachments, []);
    await render({ pendingImages, isProcessing: true, activeGenerationId: "generation" }); await h.click(".sendBtn"); assert.deepEqual(h.last("steerGeneration").imageAttachments, []);
  });
  test("steering waits for images and cannot submit after unmount", async () => {
    let complete!: (images: ImageAttachment[]) => void; const ready = new Promise<ImageAttachment[]>((resolve) => { complete = resolve; });
    await render({ isProcessing: true, activeGenerationId: "generation", pendingImages: [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }], onPrepareImages: () => ready });
    await h.click(".sendBtn"); await h.click(".sendBtn"); await h.render(createElement("div"));
    await act(async () => { complete([image]); await ready; }); assert.deepEqual(sent, []);
  });

  test("image removal callbacks preserve attachment identity", async () => {
    await render({ imageAttachments: [image, { ...image, id: "no-preview", previewUri: undefined }], pendingImages: [{ requestId: "pending", name: "pending", previewUri: "blob:pending" }] });
    const buttons = [...h.container.querySelectorAll<HTMLButtonElement>(".composerImageRemove")]; for (const button of buttons) { await h.click(button); }
    assert.deepEqual(removed, ["pending", image, { ...image, id: "no-preview", previewUri: undefined }]);
    await h.click(".composerImagePreview"); assert.ok(document.querySelector('[role="dialog"]'));
    await h.key("textarea", "Escape"); assert.equal(document.querySelector('[role="dialog"]'), null);
    await h.click(h.container.querySelectorAll<HTMLButtonElement>(".composerImagePreview")[1]);
    assert.ok(document.querySelector('[role="dialog"]')); await h.key("textarea", "Escape");
  });
});

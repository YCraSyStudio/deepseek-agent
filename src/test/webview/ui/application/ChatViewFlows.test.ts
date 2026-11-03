import assert from "node:assert/strict";
import { act, createElement, type ComponentProps } from "react";
import ChatView from "@/ui/views/chatView/ChatView";
import { VsCodeProvider } from "@/ui/views/chatView/contexts";
import { DEFAULT_CONFIG, type Conversation, type ImageAttachment } from "@/contracts";
import { createUsageAggregate } from "@/shared/usage/Usage";
import { setInterfaceLanguage } from "@/ui/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("mounted chat attachment and workspace workflows", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let cancelled: number;
  let originalCreate: typeof URL.createObjectURL; let originalRevoke: typeof URL.revokeObjectURL; let revoked: string[];
  const binding = { schemaVersion: 1 as const, uri: "file:///project", name: "Project", revision: "revision", folders: [], capabilities: { files: false, search: false, git: false, terminal: false } };
  const conversation: Conversation = { schemaVersion: 2, id: "chat-1", title: "Chat", createdAt: 1, updatedAt: 1, messages: [], model: DEFAULT_CONFIG.model, workspaceUri: "file:///project", workspaceBinding: binding };
  const image: ImageAttachment = { id: "image", fileId: "file-api-image", name: "image.png", mediaType: "image/png", size: 3, source: "picker", uploadedAt: 1, expiresAt: 9999999999999, apiBaseUrl: "https://api.deepseek.com", cacheFileName: "image.png", previewUri: "https://webview.test/image.png" };
  setup(async () => {
    h = await createDomHarness(); setInterfaceLanguage("en"); cancelled = 0; revoked = [];
    originalCreate = URL.createObjectURL; originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:local-preview"; URL.revokeObjectURL = (uri) => { revoked.push(uri); };
  });
  teardown(async () => { await h.dispose(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; });
  async function render(patch: Partial<ComponentProps<typeof ChatView>> = {}) {
    await h.render(createElement(VsCodeProvider, null, createElement(ChatView, { loadedConversation: conversation, onCancelWorkspaceMismatch: () => { cancelled++; }, ...patch })));
  }
  async function ready(config = {}) {
    await h.message({ type: "configLoaded", revision: 1, config: { ...DEFAULT_CONFIG, historyEnabled: false, ...config } });
    await h.message({ type: "apiKeyStatus", status: "configured" });
    await context("empty"); await h.flush();
  }
  async function context(state: string, requestId = h.last("getWorkspaceContext").requestId) {
    await h.message({ type: "workspaceContextChanged", requestId, conversationId: "chat-1", context: { state, binding } });
  }
  async function paste() {
    const bytes = new Uint8Array([1, 2, 3]); const file = new h.dom.window.File([bytes], "clipboard.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    const event = new h.dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
    await act(async () => { h.query("textarea").dispatchEvent(event); });
  }
  test("adds context references without duplication and removes the chosen file", async () => {
    await render(); await ready(); const files = [{ path: "./one.ts", name: "one.ts", type: "file" }, { path: "./two.ts", name: "two.ts", type: "file" }];
    await h.message({ type: "contextFilesSelected", files }); await h.message({ type: "addReferencedFiles", files: [files[0]] });
    assert.equal(h.container.querySelectorAll(".fileChip").length, 2); await h.click(".fileChipRemove"); assert.equal(h.container.querySelectorAll(".fileChip").length, 1); assert.match(h.query(".fileChip").textContent!, /two.ts/);
  });
  test("attaches picker images and requests remote deletion when removed", async () => {
    await render(); await ready(); await h.click(".attachmentPickerTrigger"); const request = h.last("selectAttachments"); assert.equal(request.conversationId, "chat-1");
    await h.message({ type: "imageAttachmentsSelected", requestId: request.requestId, attachments: [image] }); assert.ok(h.container.querySelector(".composerImageAttachment"));
    await h.click(".composerImageRemove"); assert.equal(h.container.querySelector(".composerImageAttachment"), null); assert.deepEqual(h.last("deleteImageAttachment").attachment, image);
    await h.message({ type: "imageAttachmentDeleted", requestId: "delete", fileId: image.fileId, success: false, error: "delete failed" }); assert.match(h.query('[role="alert"]').textContent!, /delete failed/);
  });
  test("clipboard images remain local until submission and join the outgoing message", async () => {
    await render(); await ready(); await paste(); assert.equal(h.posts.some((post) => post.type === "uploadClipboardImage"), false); assert.ok(h.container.querySelector(".composerImageAttachment"));
    await h.click(".sendBtn"); const request = h.last("uploadClipboardImage"); assert.equal(request.dataBase64, "AQID"); assert.equal(request.size, 3); assert.equal(h.posts.some((post) => post.type === "sendMessage"), false);
    const uploaded = { ...image, source: "clipboard", id: "uploaded" }; await h.message({ type: "imageAttachmentsSelected", requestId: request.requestId, attachments: [uploaded] });
    await h.flush(); assert.deepEqual(h.last("sendMessage").imageAttachments, [uploaded]); assert.ok(revoked.includes("blob:local-preview"));
  });
  test("removing an unsent clipboard image revokes its URL without contacting the host", async () => {
    await render(); await ready(); await paste(); await h.click(".composerImageRemove"); assert.deepEqual(revoked, ["blob:local-preview"]); assert.equal(h.container.querySelector(".composerImageAttachment"), null); assert.equal(h.posts.some((post) => post.type === "uploadClipboardImage"), false);
  });
  test("reports upload failures and retains a removable local preview", async () => {
    await render(); await ready(); await paste(); await h.click(".sendBtn"); const request = h.last("uploadClipboardImage");
    await h.message({ type: "imageAttachmentsSelected", requestId: request.requestId, attachments: [], error: "upload failed" }); await h.flush();
    assert.match(h.query('[role="alert"]').textContent!, /upload failed/); assert.ok(h.container.querySelector(".composerImageAttachment")); assert.equal(h.posts.some((post) => post.type === "sendMessage"), false);
    await h.click(".composerImageRemove");
  });
  test("navigation during upload deletes a late remote result and never submits", async () => {
    await render(); await ready(); await paste(); await h.click(".sendBtn"); const request = h.last("uploadClipboardImage");
    await h.render(createElement("div")); await h.message({ type: "unrelated" }); await h.message({ type: "imageAttachmentsSelected", requestId: request.requestId, attachments: [{ ...image, source: "clipboard" }] }); await h.flush();
    assert.equal(h.posts.some((post) => post.type === "sendMessage"), false); assert.equal((h.last("deleteImageAttachment").attachment as ImageAttachment).fileId, image.fileId);
  });
  test("workspace mismatch confirmation rebinds the displayed conversation", async () => {
    await render(); await ready(); await context("changed"); assert.match(h.query('[role="dialog"]').textContent!, /Project/);
    await h.click(".workspaceMismatchAction.primary"); assert.deepEqual(h.last("rebindConversationWorkspace"), { type: "rebindConversationWorkspace", conversationId: "chat-1", workspaceRevision: "revision" }); assert.equal(h.container.querySelector('[role="dialog"]'), null);
  });
  test("workspace mismatch cancellation calls navigation without rebinding", async () => {
    await render(); await ready(); await context("disconnected"); await h.click(".workspaceMismatchAction:not(.primary)"); assert.equal(cancelled, 1); assert.equal(h.posts.some((post) => post.type === "rebindConversationWorkspace"), false);
  });
  test("running task stop waits for host completion and rejected stops can retry", async () => {
    await render(); await ready(); const tasks = [{ id: "session", name: "Server", command: "npm start", pid: 123 }];
    await h.message({ type: "runningTasks", conversationId: "other", tasks }); assert.equal(h.container.querySelector(".runningTask"), null);
    await h.message({ type: "runningTasks", conversationId: "chat-1", tasks }); await h.click(".runningTaskStop"); assert.equal(h.last("stopRunningTask").sessionId, "session"); assert.ok(h.query<HTMLButtonElement>(".runningTaskStop").disabled);
    await h.message({ type: "requestRejected", action: "stopRunningTask", error: "stop failed" }); assert.equal(h.query<HTMLButtonElement>(".runningTaskStop").disabled, false);
    await h.message({ type: "runningTasks", conversationId: "chat-1", tasks: [] }); assert.equal(h.container.querySelector(".runningTask"), null);
  });
  test("manual compaction correlates its result and inserts a context marker", async () => {
    const total = createUsageAggregate(true); total.count = 1; total.requests = 1;
    await render({ conversationUsage: { total, byModel: [] } }); await ready({ usageBreakdown: true }); await h.click(".usageTrigger"); await h.click(".usageCompactAction"); const request = h.last("compactContext");
    assert.equal(request.conversationId, "chat-1"); assert.ok(h.query<HTMLButtonElement>(".usageCompactAction").disabled);
    await h.message({ type: "contextCompactionResult", requestId: "stale", status: "compacted", freedTokens: 100 }); assert.ok(h.query<HTMLButtonElement>(".usageCompactAction").disabled);
    await h.message({ type: "contextCompactionResult", requestId: request.requestId, status: "compacted", freedTokens: 100 }); assert.equal(h.query<HTMLButtonElement>(".usageCompactAction").disabled, false); assert.ok(h.container.querySelector(".contextCompactionMarker"));
  });
  test("restores a persistent draft and saves edits and submission to its conversation", async () => {
    h.host.state = { schemaVersion: 5, mode: "persistent", conversationId: "chat-1", draft: "Saved question", referencedFiles: [{ path: "./saved.ts", name: "saved.ts", type: "file" }], imageAttachments: [image] };
    await render(); await ready({ historyEnabled: true }); await h.flush();
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "Saved question"); assert.ok(h.container.querySelector(".fileChip")); assert.ok(h.container.querySelector(".composerImageAttachment"));
    await h.input("textarea", "Edited question"); assert.equal((h.host.state as { draft: string }).draft, "Edited question");
    await h.click(".sendBtn"); assert.equal(h.last("sendMessage").text, "Edited question"); assert.equal((h.host.state as { draft: string }).draft, "");
  });
  test("a missing restored conversation reports the error and releases the saved conversation identity", async () => {
    h.host.state = { schemaVersion: 5, mode: "persistent", conversationId: "chat-1", draft: "Saved question", referencedFiles: [], imageAttachments: [] };
    await render({ loadedConversation: null }); await ready({ historyEnabled: true }); await h.flush(); const request = h.last("loadConversation");
    await h.message({ type: "historyError", requestId: "stale", error: "ignored error" }); assert.equal(h.container.querySelector('[role="alert"]'), null);
    await h.message({ type: "historyError", requestId: request.requestId, error: "Conversation not found" });
    assert.match(h.query('[role="alert"]').textContent!, /Conversation not found/); assert.equal(h.last("getWorkspaceContext").conversationId, undefined);
  });
  test("draft attachment persistence errors are visible without discarding the current text", async () => {
    await render(); await ready(); await h.input("textarea", "Current draft");
    await act(async () => { window.dispatchEvent(new h.dom.window.CustomEvent("draft-attachments-error")); });
    assert.match(h.query('[role="alert"]').textContent!, /Could not save or restore draft attachments/); assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "Current draft");
  });

  test("restores queued drafts with image and file context and consumes only the selected draft", async () => {
    await render(); await ready();
    await h.message({ type: "generationSnapshot", generations: [], recoveredDrafts: [{ conversationId: "chat-1", messages: [{ clientRequestId: "queued", text: "Recovered question", imageAttachments: [image], referencedFiles: [{ path: "./file.ts", type: "file" }] }, { clientRequestId: "second", text: "Second question" }] }] });
    const restore = [...h.container.querySelectorAll<HTMLButtonElement>(".statusMessage button")].find((button) => button.textContent?.includes("Recovered question")); assert.ok(restore); await h.click(restore);
    assert.equal(h.query<HTMLTextAreaElement>("textarea").value, "Recovered question"); assert.equal(h.last("consumeRecoveredDraft").clientRequestId, "queued"); assert.ok(h.container.querySelector(".fileChip")); assert.ok(h.container.querySelector(".composerImageAttachment")); assert.match(h.container.textContent!, /Second question/);
  });
});

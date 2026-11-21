import ChatMessages from "@webview/components/chatView/messages/ChatMessages";
import type { ChatMessage } from "@webview/views/chatView/ChatViewTypes";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { MarkdownMessage, PlainText } from "@webview/components/chatView/messages/MarkdownMessage";
import { AssistantActivity } from "@webview/components/chatView/messages/AssistantActivity";
import EditedFilesSummary from "@webview/components/chatView/messages/EditedFilesSummary";
import ToolCallTimeline from "@webview/components/chatView/tools/timeline/ToolCallTimeline";
import { useCodeActionHandler } from "@webview/hooks/chat/UseCodeActionHandler";
import { VsCodeProvider } from "@webview/views/chatView/contexts";
import { getVsCodeApi } from "@webview/VsCodeApi";
import type { AssistantTimelineEvent } from "@/contracts";
import type { ToolCallGroup, ToolCallState } from "@webview/views/chatView/ChatViewTypes";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

suite("message presentation and saved changes", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  const render = (node: ReactNode) => h.render(createElement("div", null, node));

  test("user image previews enlarge, close and insert numbered references without stealing focus", async () => {
    const attachment = { id: "image", fileId: "file-1", name: "screen.png", mediaType: "image/png" as const,
      size: 12, source: "picker" as const, uploadedAt: 1, expiresAt: 100, apiBaseUrl: "https://api.deepseek.com", cacheFileName: "screen.png" };
    const messages: ChatMessage[] = [{ id: "user", role: "user", content: "Inspect these", imageAttachments: [
      { ...attachment, id: "numbered", imageNumber: 7, previewUri: "https://webview.test/numbered.png" },
      { ...attachment, id: "unnumbered", previewUri: "https://webview.test/plain.png" },
      { ...attachment, id: "fallback-numbered", imageNumber: 8 },
      { ...attachment, id: "fallback" },
    ] }];
    const references: number[] = [];
    await render(createElement(ChatMessages, { messages, onReferenceImage: number => references.push(number) }));
    assert.equal(h.container.querySelectorAll(".messageImageButton").length, 2);
    assert.equal(h.query(".messageImageButton").getAttribute("title"), "#7 · screen.png");
    assert.match(h.query(".messageImageFallback").textContent!, /#8 · screen.png/);
    const mouseDown = new h.dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    h.query(".messageImageNumber").dispatchEvent(mouseDown); assert.equal(mouseDown.defaultPrevented, true);
    await h.click(".messageImageNumber"); assert.deepEqual(references, [7]);
    await h.click(".messageImageButton");
    assert.equal(h.query(".imageLightboxImage").getAttribute("src"), "https://webview.test/numbered.png");
    await h.click(".imageLightboxClose"); assert.equal(h.container.querySelector(".imageLightbox"), null);
    await render(createElement(ChatMessages, { messages }));
    await h.click(".messageImageNumber"); assert.deepEqual(references, [7]);
  });

  test("message roles retain error, compaction, plain-text and assistant presentations", async () => {
    const messages: ChatMessage[] = [
      { id: "error", role: "error", content: "Provider unavailable" },
      { id: "context", role: "context", content: "summary" },
      { id: "tool", role: "tool", content: "<tool output>" },
      { id: "user-empty", role: "user", content: "" },
      { id: "assistant", role: "assistant", content: "", generationStatus: "completed" },
    ];
    await render(createElement(ChatMessages, { messages }));
    assert.equal(h.query(".errorMessage").textContent, "Provider unavailable");
    assert.ok(h.container.querySelector(".contextCompactionMarker"));
    assert.match(h.query(".message.tool").textContent!, /<tool output>/);
    assert.equal(h.container.querySelector("tool"), null);
    await render(createElement(ChatMessages, { messages, isProcessing: true, activeToolCallGroups: [group([])] }));
    assert.equal(h.container.querySelectorAll(".message").length, 5);
  });

  test("plain text preserves newlines and escapes HTML", async () => {
    await render(createElement(PlainText, { content: "First\n<img src=x>\nThird" }));
    assert.equal(h.container.querySelectorAll("br").length, 2); assert.equal(h.container.querySelector("img"), null);
    assert.match(h.container.textContent!, /<img src=x>/);
  });

  for (const [language, label] of [["ts", "TypeScript"], ["cs", "C#"], ["py", "Python"], ["sh", "Shell"], ["yml", "yml"], ["unknown-lang", "unknown-lang"], ["", "text"]]) {
    test(`markdown code fences retain text and label ${language || "untyped"} blocks`, async () => {
      await render(createElement(MarkdownMessage, { role: "assistant", content: `\u0060\u0060\u0060${language}\nconst value = 42;\n\u0060\u0060\u0060` }));
      assert.equal(h.query(".lang-label").textContent, label);
      assert.equal(h.query(".code-block").getAttribute("data-code-text"), "const value = 42;");
      assert.equal(h.container.querySelectorAll("[data-code-action]").length, 2);
      assert.match(h.query(".code-block code").textContent!, /const value = 42;/);
    });
  }

  test("inline code, GFM tables and sanitized links remain safe to render", async () => {
    await render(createElement(MarkdownMessage, { role: "user", content: '`inline`\n\n| Column | Value |\n| --- | --- |\n| A | B |\n\n[unsafe](javascript:alert(1))\n\n<script>alert(1)</script>' }));
    assert.equal(h.query(".inline-code").textContent, "inline"); assert.ok(h.container.querySelector("table"));
    assert.equal(h.container.querySelector("script"), null);
    assert.ok(![...h.container.querySelectorAll("a")].some((link) => link.getAttribute("href")?.startsWith("javascript:")));
    await render(createElement(MarkdownMessage, { role: "user", content: '```js\nreturn true;\n```' }));
    assert.ok(h.container.querySelector("[data-code-action='copy']")); assert.equal(h.container.querySelector("[data-code-action='insert']"), null);
  });

  test("copy and insert actions send the exact unhighlighted code", async () => {
    function Actions() {
      const handler = useCodeActionHandler(getVsCodeApi());
      return createElement("div", { onClick: handler }, createElement(MarkdownMessage, { role: "assistant", content: '```ts\nconst answer = 42;\n```' }));
    }
    await render(createElement(Actions));
    await h.click("[data-code-action='copy']"); await h.click("[data-code-action='insert']");
    assert.deepEqual(h.posts, [{ type: "copyCode", code: "const answer = 42;" }, { type: "insertCode", code: "const answer = 42;" }]);
  });

  test("code actions tolerate missing hosts, non-action clicks and empty blocks", async () => {
    function Actions({ connected }: { connected: boolean }) {
      const handler = useCodeActionHandler(connected ? getVsCodeApi() : null);
      return createElement("div", { onClick: handler },
        createElement("button", { className: "ordinary" }, "Other"),
        createElement("div", { className: "code-block" }, createElement("code", null, "fallback code"), createElement("button", { "data-code-action": "copy" }, "Copy")),
        createElement("button", { className: "orphan", "data-code-action": "copy" }, "Orphan"),
        createElement("div", { className: "code-block", "data-code-text": "valid" }, createElement("button", { "data-code-action": "" }, "Missing action"), createElement("button", { "data-code-action": "custom" }, "Unknown action")));
    }
    await render(createElement(Actions, { connected: false })); await h.click("[data-code-action='copy']"); assert.deepEqual(h.posts, []);
    await render(createElement(Actions, { connected: true }));
    await h.click(".ordinary"); await h.click(".orphan"); await h.click("[data-code-action='']"); await h.click("[data-code-action='custom']"); assert.deepEqual(h.posts, []);
    await h.click(".code-block [data-code-action='copy']"); assert.deepEqual(h.posts, [{ type: "copyCode", code: "fallback code" }]);
  });

  test("live reasoning, narration and tool rounds stay ordered and filter unrelated tool IDs", async () => {
    const toolGroups = [group([call("chosen"), call("unrelated")])];
    const timeline: AssistantTimelineEvent[] = [{ id: "reason", type: "reasoning", content: "Inspecting the project" }, { id: "tools", type: "tool-group", round: 1, toolCallIds: ["chosen"] }];
    await render(createElement(AssistantActivity, { timeline, toolCallGroups: toolGroups, isActive: true,
      renderToolCallGroups: (groups) => createElement("div", { className: "rendered-tools" }, groups.flatMap((item) => item.toolCalls.map((tool) => tool.toolCallId)).join(",")) }));
    assert.equal(h.query<HTMLDetailsElement>(".activity-block").open, true);
    assert.match(h.query(".reasoning-content").textContent!, /Inspecting/);
    assert.equal(h.query(".rendered-tools").textContent, "chosen");
    await h.click(".activityReasoning > summary"); await h.flush(); assert.equal(h.query<HTMLDetailsElement>(".activityReasoning").open, false);
    await h.click(".activityToolList > summary"); await h.flush(); assert.equal(h.query<HTMLDetailsElement>(".activityToolList").open, false);
    await render(createElement(AssistantActivity, { timeline: [timeline[0]!, { id: "narration", type: "content", content: "Running the check" }, timeline[1]!, { id: "final", type: "content", content: "Final answer" }], toolCallGroups: toolGroups, generationStatus: "completed" }));
    assert.match(h.query(".activityNarration").textContent!, /Running/);
    assert.match(h.query(".chronologicalAssistant").textContent!, /Final answer/); assert.equal(h.query<HTMLDetailsElement>(".activity-block").open, false);
  });

  for (const generationStatus of [undefined, "completed", "error", "cancelled", "interrupted"] as const) {
    test(`missing tool groups retain a safe ${generationStatus ?? "unknown"} terminal presentation`, async () => {
      const timeline: AssistantTimelineEvent[] = [{ id: "reason", type: "reasoning", content: "Thought" }, { id: "tools", type: "tool-group", round: 99, toolCallIds: ["missing"] }];
      await render(createElement(AssistantActivity, { timeline, toolCallGroups: [group([])], generationStatus }));
      assert.equal(h.container.querySelector(".activityToolList"), null);
      assert.equal(Boolean(h.container.querySelector(".generationTerminalStatus")), generationStatus === "cancelled" || generationStatus === "interrupted");
      if (generationStatus === "interrupted") {
        await render(createElement(AssistantActivity, { timeline, toolCallGroups: [], generationStatus, generationStopReason: "steered" }));
        assert.equal(h.container.querySelector(".generationTerminalStatus"), null);
      }
    });
  }

  test("an empty or filtered tool group does not create a fictitious tool list", async () => {
    await render(createElement(AssistantActivity, { timeline: [{ id: "tools", type: "tool-group", round: 1, toolCallIds: ["other"] }], toolCallGroups: [group([call("chosen")])], isActive: true }));
    assert.equal(h.container.querySelector(".activityToolList"), null);
  });

  test("saved changes list the first three files, expand and send an exact diff request", async () => {
    const groups = [group(Array.from({ length: 5 }, (_, index) => edit(`src/file-${index}.ts`, `edit-${index}`)))];
    await render(createElement(VsCodeProvider, { children: createElement(EditedFilesSummary, { toolCallGroups: groups, conversationId: "chat-1", generationId: "turn-1" }) }));
    assert.equal(h.container.querySelectorAll(".editedFileRow").length, 3);
    assert.match(h.query(".editedFilesTotals").textContent!, /\+10-5/);
    await h.click(".editedFilesToggle"); assert.equal(h.container.querySelectorAll(".editedFileRow").length, 5);
    await h.click(".editedFilesToggle"); assert.equal(h.container.querySelectorAll(".editedFileRow").length, 3);
    await h.click(".editedFileRow"); const request = h.last("openFileDiff");
    assert.equal(request.path, "src/file-0.ts"); assert.equal(request.preview, true); assert.equal(request.conversationId, "chat-1");
  });

  test("persisted turn reviews correlate results and retain revert errors until success", async () => {
    await render(createElement(VsCodeProvider, { children: createElement(EditedFilesSummary, { toolCallGroups: [], conversationId: "chat-1", generationId: "turn-1" }) }));
    assert.equal(h.container.querySelector(".editedFilesSummary"), null);
    const query = h.last("getWorkspaceTurn"); assert.equal(query.requestId, "turn-query:turn-1");
    await h.message({ type: "workspaceTurn", conversationId: "other", generationId: "turn-1", paths: ["wrong"] }); assert.equal(h.container.querySelector(".editedFilesSummary"), null);
    await h.message({ type: "workspaceTurn", conversationId: "chat-1", generationId: "turn-1", requestId: query.requestId, error: "No stored turn" }); assert.equal(h.container.querySelector(".editedFilesError"), null);
    await h.message({ type: "workspaceTurn", conversationId: "chat-1", generationId: "turn-1", paths: ["saved.ts"], reverted: false });
    assert.equal(h.query(".editedFilePath").textContent, "saved.ts"); assert.equal(h.container.querySelector(".editedFileStats"), null);
    await h.click(".editedFileRow"); assert.equal(h.last("reviewWorkspaceTurn").path, "saved.ts");
    await h.click(".editedFilesRevert"); assert.equal(h.query<HTMLButtonElement>(".editedFilesRevert").disabled, true);
    const request = h.last("revertWorkspaceTurn"); assert.equal(request.generationId, "turn-1");
    await h.message({ type: "workspaceTurn", conversationId: "chat-1", generationId: "turn-1", requestId: request.requestId, error: "File changed since this turn" });
    assert.match(h.query(".editedFilesError").textContent!, /changed/); assert.equal(h.query<HTMLButtonElement>(".editedFilesRevert").disabled, false);
    await h.message({ type: "workspaceTurn", conversationId: "chat-1", generationId: "turn-1", paths: ["saved.ts"], reverted: true });
    assert.equal(h.container.querySelector(".editedFilesError"), null); assert.equal(h.query<HTMLButtonElement>(".editedFilesRevert").disabled, true);
  });

  test("matching review paths combine recorded stats with snapshot-only files", async () => {
    await render(createElement(VsCodeProvider, { children: createElement(EditedFilesSummary, { toolCallGroups: [group([edit("known.ts", "edit")])], conversationId: "chat-1", generationId: "turn-1" }) }));
    await h.message({ type: "workspaceTurn", conversationId: "chat-1", generationId: "turn-1", paths: ["known.ts", "snapshot-only.ts"], reverted: false });
    assert.equal(h.container.querySelectorAll(".editedFileRow").length, 2); assert.equal(h.container.querySelectorAll(".editedFileStats").length, 1);
  });

  test("file summaries with no host or no changes do not advertise unavailable actions", async () => {
    await render(createElement(EditedFilesSummary, { toolCallGroups: [group([edit("file.ts", "edit")])] })); assert.equal(h.container.textContent, "");
    await render(createElement(VsCodeProvider, { children: createElement(EditedFilesSummary, { toolCallGroups: [] }) })); assert.equal(h.container.textContent, "");
    await render(createElement(VsCodeProvider, { children: createElement(EditedFilesSummary, { toolCallGroups: [group([edit("file.ts", "edit")])] }) }));
    assert.equal(h.container.querySelector(".editedFilesRevert"), null); await h.click(".editedFileRow"); assert.equal(h.last("openFileDiff").path, "file.ts");
  });

  for (const status of ["pending", "awaiting_confirmation", "running", "completed", "error", "rejected", "cancelled"] as const) {
    test(`tool timeline presents ${status} calls and their file actions`, async () => {
      const tool = edit("src/file.ts", "edit"); tool.status = status;
      await render(createElement(ToolCallTimeline, { groups: [group([tool])], vscode: getVsCodeApi(), conversationId: "chat-1" }));
      assert.ok(h.query(`.toolCallItem.${status}`));
      await h.click(".toolCallActions button"); assert.equal(h.last("openFile").path, "src/file.ts");
      if (status === "completed") { await h.click(h.container.querySelectorAll<HTMLButtonElement>(".toolCallActions button")[1]!); assert.equal(h.last("openFileDiff").path, "src/file.ts"); }
    });
  }

  test("empty timelines and calls without host-dependent actions remain safe", async () => {
    await render(createElement(ToolCallTimeline, { groups: [], vscode: null })); assert.equal(h.container.textContent, "");
    await render(createElement(ToolCallTimeline, { groups: [group([{ ...call("plain"), arguments: "", result: undefined }])], vscode: null }));
    assert.equal(h.container.querySelector(".toolCallActions"), null); assert.equal(h.container.querySelector(".toolCallArgs"), null);
  });
});

function call(id: string): ToolCallState { return { toolCallId: id, toolName: "read_file", arguments: '{"path":"file.ts"}', status: "completed", round: 1 }; }
function group(toolCalls: ToolCallState[]): ToolCallGroup { return { id: "round-1", round: 1, expanded: true, toolCalls }; }
function edit(file: string, id: string): ToolCallState {
  return { toolCallId: id, toolName: "edit_file", arguments: JSON.stringify({ path: file, search: "old", replace: "new" }), status: "completed", round: 1,
    result: JSON.stringify({ toolResultVersion: 1, type: "fileEdit", path: file, summary: "Updated", diff: `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new`, diffStats: { additions: 2, deletions: 1 }, beforeHash: "a".repeat(64), afterHash: "b".repeat(64) }) };
}

import assert from "node:assert/strict";
import { act, createElement } from "react";
import Modal from "@webview/components/chatView/tools/confirmations/ToolCallConfirmationModal";
import type { ToolCallState } from "@webview/views/chatView/ChatViewTypes";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

suite("tool confirmation dialog behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let actions: string[];
  const call = (patch: Partial<ToolCallState> = {}): ToolCallState => ({ toolCallId: "call", toolName: "custom_tool", arguments: "", status: "awaiting_confirmation", round: 1, requiresConfirmation: true, ...patch });
  setup(async () => { h = await createDomHarness(); actions = []; setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  const render = (calls: ToolCallState[], disabled = false) => h.render(createElement(Modal, {
    pendingToolCalls: calls, disabled, onExecute: id => { actions.push(`execute:${id}`); }, onReject: id => { actions.push(`reject:${id}`); },
    onExecuteAll: () => { actions.push("execute-all"); }, onRejectAll: () => { actions.push("reject-all"); },
  }));
  test("closes without pending calls and routes individual decisions and Escape to the active call", async () => {
    await render([]); assert.equal(h.container.querySelector("[role=dialog]"), null);
    await render([call()]); assert.equal(h.container.querySelector("details"), null);
    await h.click(".toolCallDecisionOption.primary"); await h.click("[data-dialog-initial-focus]");
    await h.key("[role=dialog]", "Escape");
    assert.deepEqual(actions, ["execute:call", "reject:call", "reject:call"]);
  });
  test("offers batch decisions only for multiple ordinary manual confirmations", async () => {
    const dangerous = call({ toolCallId: "danger", dangerConfirmation: { requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "Review" } });
    await render([call(), dangerous]); assert.equal(h.container.querySelector(".toolCallModalBatchActions"), null);
    await render([call(), call({ toolCallId: "second" }), dangerous, call({ toolCallId: "automatic", requiresConfirmation: false })]);
    await h.click(".toolCallModalBatchActions button"); await h.click(".toolCallModalBatchActions button.secondary");
    assert.deepEqual(actions, ["execute-all", "reject-all"]);
    await render([call(), call({ toolCallId: "second" })], true);
    for (const button of h.container.querySelectorAll<HTMLButtonElement>("button")) { assert.equal(button.disabled, true); await h.click(button); }
    assert.deepEqual(actions, ["execute-all", "reject-all"]);
  });
  for (const [dangerLevel, heading, severity] of [
    ["destructive", "Destructive Action", "severityDestructive"],
    ["dangerous", "Potentially Dangerous Action", "severityDangerous"],
    ["caution", "Caution Required", "severityCaution"],
  ] as const) {
    test(`shows ${dangerLevel} severity and explicit one-time decisions`, async () => {
      await render([call({ toolName: "create_file", arguments: '{"content":"New file"}', dangerConfirmation: {
        requiresConfirmation: true, dangerLevel, warningMessage: "Review this operation", filePath: "/workspace/a.ts", cwd: "/workspace", shell: "bash",
      } })]);
      assert.equal(h.query("h3").textContent, `${heading}: Review this operation`);
      assert.ok(h.container.querySelector(`.${severity}`)); assert.match(h.query("header p").textContent ?? "", /a\.ts/);
      assert.match(h.query(".dangerConfirmation").textContent ?? "", /bash/);
      await h.click(".toolCallOpenFile"); assert.deepEqual(h.last("openFile"), { type: "openFile", path: "/workspace/a.ts" });
      await h.click(".dangerConfirmBtn"); await h.click(".dangerCancelBtn");
      assert.deepEqual(actions, ["execute:call", "reject:call"]);
      await render([call({ dangerConfirmation: { requiresConfirmation: true, dangerLevel, warningMessage: "Review" } })], true);
      assert.equal(h.query("header p").textContent, "Review before executing.");
      await h.click(".dangerConfirmBtn"); await h.click(".dangerCancelBtn"); assert.equal(actions.length, 2);
    });
  }
  test("opens argument paths only for supported file operations", async () => {
    for (const toolName of ["read_file", "create_file", "edit_file"]) {
      await render([call({ toolName, arguments: '{"path":"src/file.ts","content":"Body"}' })]);
      await h.click(".toolCallOpenFile"); assert.equal(h.last("openFile").path, "src/file.ts");
    }
    for (const argumentsJson of ['{"path":1}', '{"path":"  "}', "null", "{"]) {
      await render([call({ toolName: "edit_file", arguments: argumentsJson })]); assert.equal(h.container.querySelector(".toolCallOpenFile"), null);
    }
    await render([call({ toolName: "list_directory", arguments: '{"path":"src"}' })]);
    assert.equal(h.container.querySelector(".toolCallOpenFile"), null); assert.equal(h.container.querySelector(".toolCallFullReview"), null);
    const event = new h.dom.window.MouseEvent("mousedown", { bubbles: true }); let bubbled = false;
    const listener = () => { bubbled = true; }; h.dom.window.document.addEventListener("mousedown", listener);
    await act(async () => { h.query(".toolCallModalBackdrop").dispatchEvent(event); });
    h.dom.window.document.removeEventListener("mousedown", listener); assert.equal(bubbled, false);
  });
  test("shows full command, content, replacement and query arguments while retaining raw invalid input", async () => {
    for (const key of ["command", "content", "replace", "query"]) {
      await render([call({ arguments: JSON.stringify({ [key]: `${key} body` }) })]);
      assert.equal(h.query(".toolCallFullReview code").textContent, `${key} body`);
    }
    for (const argumentsJson of ["null", "[]", "42", "{invalid"]) {
      await render([call({ arguments: argumentsJson })]); assert.equal(h.query(".toolCallFullReview code").textContent, argumentsJson);
    }
    await render([call({ arguments: '{"other":1}' })]); assert.equal(h.query(".toolCallFullReview code").textContent, '{\n  "other": 1\n}');
  });
  test("renders full patch lines and detects diff-shaped content in other tools", async () => {
    const patch = "*** Begin Patch\n@@ context\n-old\n+new\nunchanged";
    for (const key of ["patch", "content"]) {
      await render([call({ toolName: "apply_patch", arguments: JSON.stringify({ [key]: patch }) })]);
      assert.equal(h.container.querySelectorAll(".diffHunk").length, 2);
      assert.equal(h.query(".diffRemove").textContent, "-old\n"); assert.equal(h.query(".diffAdd").textContent, "+new\n");
    }
    for (const content of ["@@ a\n+new", "*** Begin Patch\n+new"]) {
      await render([call({ arguments: JSON.stringify({ content }) })]); assert.ok(h.container.querySelector(".diffReview"));
    }
  });
});

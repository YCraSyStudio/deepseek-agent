import assert from "node:assert/strict";
import { act, createElement } from "react";
import { useToolCallController } from "@webview/hooks/chat/UseToolCallController";
import { getVsCodeApi } from "@webview/VsCodeApi";
import { createDomHarness } from "../../../../support/DomHarness";

suite("chat tool batch decisions", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let controller: ReturnType<typeof useToolCallController>;
  function Fixture({ disabled }: { disabled: boolean }) {
    controller = useToolCallController({ conversationId: "chat", messages: [], isProcessing: true, vscode: getVsCodeApi(), actionsDisabled: disabled }); return null;
  }
  setup(async () => { h = await createDomHarness(); });
  teardown(async () => { await h.dispose(); });
  for (const disabled of [false, true]) {
    test(`batches only ordinary manual decisions and honors disabled actions=${disabled}`, async () => {
      await h.render(createElement(Fixture, { disabled }));
      const call = (id: string) => ({ id, type: "function" as const, function: { name: "lookup", arguments: "{}" } });
      await act(async () => {
        controller.dispatcher.onToolCallConfirmationRequired!({ generationId: "generation", round: 1, autoExecute: false, toolCalls: [call("first"), call("second")] });
        controller.dispatcher.onToolCallConfirmationRequired!({ generationId: "generation", round: 2, autoExecute: true, toolCalls: [call("automatic")] });
        controller.dispatcher.onToolCallConfirmationRequired!({ generationId: "generation", round: 3, autoExecute: false, toolCalls: [call("dangerous")], dangerConfirmation: { requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "Review individually" } });
      });
      assert.deepEqual(controller.pendingToolCalls.map(call => call.toolCallId), ["first", "second", "dangerous"]);
      await act(async () => { controller.handleExecuteAll(); controller.handleRejectAll(); });
      const posts = h.posts.filter(post => post.type === "executeToolCall");
      assert.deepEqual(posts.map(post => [post.toolCallId, post.action]), disabled ? [] : [["first", "execute"], ["second", "execute"], ["first", "reject"], ["second", "reject"]]);
      assert.ok(posts.every(post => post.generationId === "generation"));
    });
  }
});

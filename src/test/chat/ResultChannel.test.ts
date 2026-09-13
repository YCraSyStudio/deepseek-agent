import * as assert from "node:assert";
import { createExecutionResult } from "@/application/tools/ToolExecutor";
import {
  createErrorResult,
  createRejectedResult,
  postToolCallResult,
} from "@/vscode/webviews/handlers/chat/toolCalls/execution/ResultChannel";
import { recordInitialToolCall } from "@/vscode/webviews/handlers/chat/toolCalls/execution/ToolCallLedger";
import { createExecutionContext, toolCall } from "./executionHarness";

suite("tool result channel", () => {
  test("publishes a redacted result and stores it as completed", () => {
    const { context, published, publishedResults } = createExecutionContext();
    const call = toolCall("run_terminal_command", { command: "npm test" });
    recordInitialToolCall(call, context);
    postToolCallResult(context, createExecutionResult(call, {
      kind: "completed",
      content: JSON.stringify({ exitCode: 0, token: "private-value" }),
    }));

    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0]?.type, "toolCallResult");
    assert.strictEqual(published[0]?.toolName, "run_terminal_command");
    assert.strictEqual(published[0]?.status, "completed");
    assert.strictEqual(published[0]?.isError, false);
    assert.ok(!(publishedResults[0] ?? "").includes("private-value"));

    const stored = context.executedToolCalls.get(call.id);
    assert.strictEqual(stored?.status, "completed");
    assert.strictEqual(stored?.isError, false);
    assert.strictEqual(stored?.requiresConfirmation, false);
    assert.ok(!(stored?.result ?? "").includes("private-value"));
  });

  test("maps a confirmation result to awaiting confirmation", () => {
    const { context, published } = createExecutionContext();
    const call = toolCall("edit_file", { path: "src/app.ts" });
    recordInitialToolCall(call, context);
    postToolCallResult(context, createExecutionResult(call, {
      kind: "confirmation_required",
      content: JSON.stringify({ requiresConfirmation: true, dangerLevel: "caution", warningMessage: "Apply?" }),
      dangerLevel: "caution",
    }));

    assert.strictEqual(published[0]?.status, "awaiting_confirmation");
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "awaiting_confirmation");
  });

  test("taints the generation after a successful web read but not after a failure", () => {
    const { context, webTainted } = createExecutionContext();
    postToolCallResult(context, createExecutionResult(toolCall("run_terminal_command"), { kind: "completed", content: "ok" }));
    assert.strictEqual(webTainted(), false);

    postToolCallResult(context, createExecutionResult(toolCall("search_web"), { kind: "error", content: "no index" }));
    assert.strictEqual(webTainted(), false);

    postToolCallResult(context, createExecutionResult(toolCall("search_web"), { kind: "completed", content: "results" }));
    assert.strictEqual(webTainted(), true);
  });

  test("builds rejected and error results with their stored status", () => {
    const call = toolCall("edit_file", { path: "src/app.ts" });

    const rejected = createRejectedResult(call, "Tool call rejected by user");
    assert.strictEqual(rejected.outcome.kind, "rejected");
    assert.strictEqual(rejected.status, "rejected");
    assert.strictEqual(rejected.rejected, true);

    const error = createErrorResult(call, "Tool call cycle not available");
    assert.strictEqual(error.outcome.kind, "error");
    assert.strictEqual(error.status, "error");
    assert.strictEqual(error.outcome.content, "Tool call cycle not available");
  });
});

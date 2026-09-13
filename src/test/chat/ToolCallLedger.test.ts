import * as assert from "node:assert";
import {
  recordInitialToolCall,
  updateStoredToolCall,
} from "@/vscode/webviews/handlers/chat/toolCalls/execution/ToolCallLedger";
import { createExecutionContext, toolCall } from "./executionHarness";

suite("tool call ledger", () => {
  test("records a manual call as awaiting confirmation and redacts its arguments", () => {
    const { context } = createExecutionContext();
    const call = toolCall("run_terminal_command", { command: "npm test", token: "private-value" });
    recordInitialToolCall(call, context);

    const stored = context.executedToolCalls.get(call.id);
    assert.strictEqual(stored?.status, "awaiting_confirmation");
    assert.strictEqual(stored?.requiresConfirmation, true);
    assert.strictEqual(stored?.toolName, "run_terminal_command");
    assert.ok(!(stored?.arguments ?? "").includes("private-value"));
    assert.match(stored?.arguments ?? "", /\[REDACTED\]/);
  });

  test("records an automatic call as running without confirmation", () => {
    const { context } = createExecutionContext({ permissionMode: "full-access", round: 3 });
    const call = toolCall("read_file", { path: "README.md" });
    recordInitialToolCall(call, context);

    const stored = context.executedToolCalls.get(call.id);
    assert.strictEqual(stored?.status, "running");
    assert.strictEqual(stored?.requiresConfirmation, false);
    assert.strictEqual(stored?.round, 3);
  });

  test("patches a stored call and ignores unknown ids", () => {
    const { context } = createExecutionContext();
    const call = toolCall("read_file", { path: "README.md" });
    recordInitialToolCall(call, context);

    updateStoredToolCall(context, call.id, { result: "file body", status: "completed", isError: false });
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "completed");
    assert.strictEqual(context.executedToolCalls.get(call.id)?.result, "file body");

    assert.doesNotThrow(() => updateStoredToolCall(context, "missing-call", { status: "completed" }));
    assert.strictEqual(context.executedToolCalls.size, 1);
  });
});

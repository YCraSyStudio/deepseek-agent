import * as assert from "node:assert";
import type { ToolMetadata } from "@/application/tools/Types";
import { executeToolCall } from "@/vscode/webviews/handlers/chat/toolCalls/ToolExecution";
import { createExecutionContext, createToolExecutorStub, toolCall } from "./executionHarness";

const readOnlyMetadata: Record<string, ToolMetadata> = {
  read_file: { dangerLevel: "safe", requiresConfirmation: false, effect: "read-only" },
};

const untrustedWorkspace = "Tool call rejected because the workspace is not trusted";

suite("tool execution stages", () => {
  test("rejects a mutation in an untrusted workspace without touching the executor", async () => {
    const { executor, executionCalls, forcedCalls } = createToolExecutorStub();
    const { context, publishedResults } = createExecutionContext({
      executor,
      permissionMode: "auto-approve",
      trusted: false,
    });
    const call = toolCall("run_terminal_command", { command: "npm test" });

    const result = await executeToolCall(call, context);

    assert.strictEqual(result, untrustedWorkspace);
    assert.deepStrictEqual(publishedResults, [untrustedWorkspace]);
    assert.strictEqual(executionCalls.length, 0);
    assert.strictEqual(forcedCalls.length, 0);
    const stored = context.executedToolCalls.get(call.id);
    assert.strictEqual(stored?.status, "rejected");
    assert.strictEqual(stored?.rejected, true);
  });

  test("still runs read-only tools in an untrusted workspace", async () => {
    const { executor, executionCalls, forcedCalls } = createToolExecutorStub({
      metadata: readOnlyMetadata,
      forcedResult: "file body",
    });
    const { context } = createExecutionContext({ executor, permissionMode: "auto-approve", trusted: false });

    const result = await executeToolCall(toolCall("read_file", { path: "README.md" }), context);

    assert.strictEqual(result, "file body");
    assert.strictEqual(forcedCalls.length, 1);
    assert.strictEqual(executionCalls.length, 0);
  });

  test("never auto-executes a manual mutation and reports the missing cycle", async () => {
    const { executor, executionCalls, forcedCalls } = createToolExecutorStub();
    const { context, confirmations } = createExecutionContext({ executor });
    const call = toolCall("edit_file", { path: "src/app.ts" });

    const result = await executeToolCall(call, context);

    assert.strictEqual(result, "Tool call cycle not available");
    assert.strictEqual(executionCalls.length, 0);
    assert.strictEqual(forcedCalls.length, 0);
    assert.strictEqual(confirmations(), 0);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "error");
  });

  test("runs a mutation with automatic permissions when it needs no confirmation", async () => {
    const { executor, executionCalls, forcedCalls } = createToolExecutorStub();
    const { context, confirmations, reviews } = createExecutionContext({ executor, permissionMode: "auto-approve" });
    const call = toolCall("run_terminal_command", { command: "npm test" });

    const result = await executeToolCall(call, context);

    assert.strictEqual(result, "completed");
    assert.strictEqual(executionCalls.length, 1);
    assert.strictEqual(forcedCalls.length, 0);
    assert.strictEqual(confirmations(), 0);
    assert.strictEqual(reviews(), 0);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "completed");
  });
});

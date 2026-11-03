import * as assert from "node:assert";
import { createExecutionResult } from "@/application/tools/ToolExecutor";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import type { ToolCall } from "@/contracts";
import type { PendingToolCallCycle } from "@/vscode/webviews/handlers/chat/toolCalls/Types";
import {
  executeManualToolCall,
  handleExecutionResult,
} from "@/vscode/webviews/handlers/chat/toolCalls/execution/ConfirmationFlow";
import { recordInitialToolCall } from "@/vscode/webviews/handlers/chat/toolCalls/execution/ToolCallLedger";
import { runWithToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { createExecutionContext, createToolExecutorStub, createWorkspaceHost, toolCall } from "./executionHarness";

const CONFIRMATION_PAYLOAD: ConfirmationRequiredResult = {
  requiresConfirmation: true,
  dangerLevel: "caution",
  warningMessage: "Review required",
  command: "npm test",
};

suite("tool confirmation flow", () => {
  test("publishes a completed result without asking for confirmation", async () => {
    const { context, publishedResults, confirmations } = createExecutionContext();
    const call = toolCall("read_file", { path: "README.md" });
    recordInitialToolCall(call, context);

    const result = await handleExecutionResult({
      toolCall: call,
      result: createExecutionResult(call, { kind: "completed", content: "file body" }),
      ctx: context,
      round: 1,
    });

    assert.strictEqual(result, "file body");
    assert.deepStrictEqual(publishedResults, ["file body"]);
    assert.strictEqual(confirmations(), 0);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "completed");
    assert.strictEqual(context.executedToolCalls.get(call.id)?.dangerLevel, undefined);
  });

  test("cancels a dangerous call, clears the diff preview, and stores the rejection", async () => {
    const cleared: string[] = [];
    await runWithToolWorkspaceHost(createWorkspaceHost({ onClearPreview: () => cleared.push("cleared") }), async () => {
      const { context, publishedResults, confirmations } = createExecutionContext({ confirmDanger: false });
      const call = toolCall("run_terminal_command", { command: "npm test" });
      recordInitialToolCall(call, context);

      const result = await handleExecutionResult({
        toolCall: call,
        result: confirmationResult(call),
        ctx: context,
        round: 2,
      });

      assert.strictEqual(result, "Tool call cancelled by user (dangerous operation)");
      assert.deepStrictEqual(publishedResults, ["Tool call cancelled by user (dangerous operation)"]);
      assert.strictEqual(confirmations(), 1);
      assert.deepStrictEqual(cleared, ["cleared"]);

      const stored = context.executedToolCalls.get(call.id);
      assert.strictEqual(stored?.status, "rejected");
      assert.strictEqual(stored?.rejected, true);
      assert.strictEqual(stored?.isError, false);
      assert.strictEqual(stored?.dangerLevel, "caution");
    });
  });

  test("runs the tool once the user confirms the danger", async () => {
    const { executor, forcedCalls } = createToolExecutorStub({ forcedResult: "command output" });
    const { context, publishedResults, confirmations } = createExecutionContext({ executor, confirmDanger: true });
    const call = toolCall("run_terminal_command", { command: "npm test" });
    recordInitialToolCall(call, context);

    const result = await handleExecutionResult({
      toolCall: call,
      result: confirmationResult(call),
      ctx: context,
      round: 2,
    });

    assert.strictEqual(result, "command output");
    assert.deepStrictEqual(publishedResults, ["command output"]);
    assert.strictEqual(confirmations(), 1);
    assert.strictEqual(forcedCalls.length, 1);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.dangerConfirmed, true);
  });

  test("honours a pipeline danger override over the tool payload", async () => {
    const { context, confirmations } = createExecutionContext({ confirmDanger: false });
    const call = toolCall("run_terminal_command", { command: "npm test" });
    recordInitialToolCall(call, context);
    const override: ConfirmationRequiredResult = {
      requiresConfirmation: true,
      dangerLevel: "destructive",
      warningMessage: "DeepSeek classified this action as critical: irreversible delete",
    };

    const result = await handleExecutionResult({
      toolCall: call,
      result: createExecutionResult(call, { kind: "completed", content: "completed" }),
      ctx: context,
      round: 1,
    }, override);

    assert.strictEqual(result, "Tool call cancelled by user (dangerous operation)");
    assert.strictEqual(confirmations(), 1);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.dangerLevel, "destructive");
  });

  test("reports a missing tool call cycle as an error result", async () => {
    const { context, publishedResults } = createExecutionContext();
    const call = toolCall("edit_file", { path: "src/app.ts" });
    recordInitialToolCall(call, context);

    const result = await executeManualToolCall(call, context);

    assert.strictEqual(result, "Tool call cycle not available");
    assert.deepStrictEqual(publishedResults, ["Tool call cycle not available"]);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "error");
    assert.strictEqual(context.executedToolCalls.get(call.id)?.isError, true);
  });

  test("returns the user rejection without executing the tool", async () => {
    const { executor, executionCalls } = createToolExecutorStub();
    const call = toolCall("edit_file", { path: "src/app.ts" });
    const { context, publishedResults } = createExecutionContext({
      executor,
      pendingCycle: pendingCycle(call, "reject"),
    });
    recordInitialToolCall(call, context);

    const result = await executeManualToolCall(call, context);

    assert.strictEqual(result, "Tool call rejected by user");
    assert.deepStrictEqual(publishedResults, ["Tool call rejected by user"]);
    assert.strictEqual(executionCalls.length, 0);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.rejected, true);
  });

  test("executes the tool after the user approves it", async () => {
    const { executor, executionCalls } = createToolExecutorStub();
    const call = toolCall("edit_file", { path: "src/app.ts" });
    const { context, publishedResults, confirmations } = createExecutionContext({
      executor,
      pendingCycle: pendingCycle(call, "execute"),
    });
    recordInitialToolCall(call, context);

    const result = await executeManualToolCall(call, context);

    assert.strictEqual(result, "completed");
    assert.deepStrictEqual(publishedResults, ["completed"]);
    assert.strictEqual(executionCalls.length, 1);
    assert.strictEqual(confirmations(), 0);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.status, "completed");
  });
});

function confirmationResult(toolCall: ToolCall) {
  return createExecutionResult(toolCall, {
    kind: "confirmation_required",
    content: JSON.stringify(CONFIRMATION_PAYLOAD),
    dangerLevel: "caution",
  });
}

function pendingCycle(toolCall: ToolCall, action: "execute" | "reject"): PendingToolCallCycle {
  return {
    toolCalls: new Map([[toolCall.id, toolCall]]),
    round: 1,
    individualResolves: new Map(),
    individualPromises: new Map([[toolCall.id, Promise.resolve(action)]]),
    resolved: new Set(),
  };
}

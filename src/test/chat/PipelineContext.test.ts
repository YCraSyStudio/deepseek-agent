import * as assert from "node:assert";
import type { ConfirmationRequiredResult, ToolMetadata } from "@/application/tools/Types";
import { runWithToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import {
  addProvenFileScope,
  getPathArgument,
  handlerContext,
  isAutomaticExecution,
  requiresWorkspaceMutationPolicy,
} from "@/vscode/webviews/handlers/chat/toolCalls/execution/PipelineContext";
import { createExecutionContext, createToolExecutorStub, createWorkspaceHost, toolCall } from "./executionHarness";

const metadata: Record<string, ToolMetadata> = {
  read_file: { dangerLevel: "safe", requiresConfirmation: false, effect: "read-only" },
  search_web: { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "external-effect" },
  edit_file: { dangerLevel: "caution", requiresConfirmation: true, effect: "workspace-mutation" },
};

suite("tool execution pipeline context", () => {
  test("derives the workspace mutation policy from tool metadata", () => {
    const { context } = createExecutionContext({ executor: createToolExecutorStub({ metadata }).executor });

    assert.strictEqual(requiresWorkspaceMutationPolicy(context, toolCall("read_file", { path: "README.md" })), false);
    assert.strictEqual(requiresWorkspaceMutationPolicy(context, toolCall("search_web", { query: "searxng" })), false);
    assert.strictEqual(requiresWorkspaceMutationPolicy(context, toolCall("edit_file", { path: "src/app.ts" })), true);
    assert.strictEqual(requiresWorkspaceMutationPolicy(context, toolCall("unknown_tool")), true);
  });

  test("detects the automatic execution modes", () => {
    assert.strictEqual(isAutomaticExecution(createExecutionContext().context), false);
    assert.strictEqual(isAutomaticExecution(createExecutionContext({ permissionMode: "auto-approve" }).context), true);
    assert.strictEqual(isAutomaticExecution(createExecutionContext({ permissionMode: "full-access" }).context), true);
  });

  test("projects the handler context exposed to tools", () => {
    const { context } = createExecutionContext({ permissionMode: "auto-approve" });
    assert.strictEqual(handlerContext(context).webTainted, false);

    context.markWebTainted?.();
    assert.strictEqual(handlerContext(context).webTainted, true);
    assert.strictEqual(handlerContext(context).trustedUserRequest, undefined);
  });

  test("reads the path argument of file and terminal calls", () => {
    assert.strictEqual(getPathArgument(toolCall("edit_file", { path: "src/app.ts" })), "src/app.ts");
    assert.strictEqual(getPathArgument(toolCall("run_terminal_command", { command: "npm test" })), undefined);
    assert.strictEqual(getPathArgument(toolCall("run_terminal_command", { command: "npm test", cwd: "/workspace" })), "/workspace");
    assert.strictEqual(getPathArgument(toolCall("search_web", { query: "searxng" })), undefined);
    assert.strictEqual(getPathArgument(toolCall("read_file", { path: "   " })), undefined);
    assert.strictEqual(getPathArgument({
      id: "call:broken",
      type: "function",
      function: { name: "read_file", arguments: "not-json" },
    }), undefined);
  });

  test("adds workspace provenance only to file mutations", async () => {
    const confirmation: ConfirmationRequiredResult = {
      requiresConfirmation: true,
      dangerLevel: "caution",
      warningMessage: "Apply 1 replacement?",
    };
    const call = toolCall("edit_file", { path: "src/app.ts" });

    const outside = await runWithToolWorkspaceHost(
      createWorkspaceHost({ contained: false }),
      () => addProvenFileScope(call, confirmation),
    );
    assert.strictEqual(outside.filePath, "src/app.ts");
    assert.strictEqual(outside.workspaceRoot, "/workspace");
    assert.strictEqual(outside.workspaceContained, false);
    assert.strictEqual(outside.reasonCode, "outside-workspace");

    const inside = await runWithToolWorkspaceHost(
      createWorkspaceHost({ contained: true }),
      () => addProvenFileScope(call, confirmation),
    );
    assert.strictEqual(inside.workspaceContained, true);
    assert.strictEqual(inside.reasonCode, undefined);

    const untouched = await addProvenFileScope(toolCall("read_file", { path: "src/app.ts" }), confirmation);
    assert.strictEqual(untouched, confirmation);
  });
});

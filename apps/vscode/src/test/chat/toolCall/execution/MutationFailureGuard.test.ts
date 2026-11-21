import * as assert from "assert";
import type { ToolCall } from "@/contracts";
import { MutationFailureGuard } from "@/vscode/webviews/handlers/chat/toolCalls/MutationFailureGuard";
import type { StoredExecution } from "@/vscode/webviews/handlers/chat/toolCalls/Types";

suite("mutation failure guard", () => {
  test("requires a read before one retry and blocks after the second failure", () => {
    const guard = new MutationFailureGuard();
    const edit = call("edit_file", { path: "src/App.ts", search: "a", replace: "b" });
    guard.record(edit, execution(edit, "error"));

    assert.match(guard.getBlockReason(call("apply_patch", { path: "src\\App.ts", diff: "patch" }))!, /Read the file/);

    const read = call("read_file", { path: "src/App.ts" });
    guard.record(read, execution(read, "completed"));
    assert.strictEqual(guard.getBlockReason(edit), undefined);

    guard.record(edit, execution(edit, "error"));
    assert.match(guard.getBlockReason(edit)!, /two mutation attempts/);
  });

  test("clears failure state after a successful retry", () => {
    const guard = new MutationFailureGuard();
    const edit = call("edit_file", { path: "src/app.ts", search: "a", replace: "b" });
    const read = call("read_file", { path: "src/app.ts" });
    guard.record(edit, execution(edit, "error"));
    guard.record(read, execution(read, "completed"));
    guard.record(edit, execution(edit, "completed"));

    assert.strictEqual(guard.getBlockReason(edit), undefined);
  });
});

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `${name}-${JSON.stringify(args)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function execution(toolCall: ToolCall, status: StoredExecution["status"]): StoredExecution {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    arguments: toolCall.function.arguments,
    status,
    isError: status === "error",
  };
}

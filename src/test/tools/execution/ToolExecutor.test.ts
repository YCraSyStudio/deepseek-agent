import * as assert from "assert";
import type { ToolCall, ToolDefinition } from "@/contracts";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { ToolRegistry } from "@/application/tools/ToolRegistry";

suite("tool executor result classification", () => {
  test("marks plain handler errors as failed", async () => {
    const executor = createExecutor(async () => "Error editing file 'src/app.ts': search text not found");

    const result = await executor.execute(createToolCall());

    assert.strictEqual(result.outcome.kind, "error");
    assert.strictEqual(result.status, "error");
  });

  test("does not classify successful plain text as an error", async () => {
    const executor = createExecutor(async () => "File contents returned successfully");

    const result = await executor.execute(createToolCall());

    assert.strictEqual(result.outcome.kind, "completed");
    assert.strictEqual(result.status, "completed");
  });

  test("preserves the analyzed workspace root in confirmation results", async () => {
    const executor = createExecutor(async () => JSON.stringify({
      requiresConfirmation: true,
      dangerLevel: "caution",
      warningMessage: "Review command",
      cwd: "C:\\workspace\\frontend",
      workspaceRoot: "C:\\workspace",
    }));

    const result = await executor.execute(createToolCall());
    const confirmation = ToolExecutor.isConfirmationRequired(result.outcome.content);

    assert.strictEqual(result.status, "confirmation_required");
    assert.strictEqual(confirmation?.workspaceRoot, "C:\\workspace");
  });

  test("never executes a mutation cancelled while waiting for the workspace lock", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {releaseFirst = resolve;});
    const started = new Promise<void>((resolve) => {firstStarted = resolve;});
    let invocations = 0;
    const registry = new ToolRegistry();
    registry.register({
      definition: { ...testToolDefinition, function: { ...testToolDefinition.function, name: "edit_file" } },
      handler: async () => {
        invocations += 1;
        if (invocations === 1) {
          firstStarted();
          await blocker;
        }
        return "completed";
      },
      metadata: { dangerLevel: "safe", requiresConfirmation: false },
    });
    const executor = new ToolExecutor(registry, () => "workspace:test");
    const first = executor.execute(createToolCall("first", "edit_file"));
    await started;
    const controller = new AbortController();
    const second = executor.execute(createToolCall("second", "edit_file"), { signal: controller.signal });

    controller.abort();
    releaseFirst();
    await first;

    await assert.rejects(second, (error: unknown) => error instanceof Error && error.name === "AbortError");
    assert.strictEqual(invocations, 1);
  });
});

function createExecutor(handler: () => Promise<string>): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register({
    definition: testToolDefinition,
    handler,
    metadata: {
      dangerLevel: "safe",
      requiresConfirmation: false,
    },
  });
  return new ToolExecutor(registry);
}

function createToolCall(id = "call_1", name = "read_file"): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify({ path: "src/app.ts" }),
    },
  };
}

const testToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Test tool",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

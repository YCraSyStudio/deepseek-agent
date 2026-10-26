import * as assert from "assert";
import type { ToolCall } from "@/contracts";
import { readFileDefinition, readFileHandler, readFileMetadata } from "@/infrastructure/tools/builtins/fileSystem/ReadFile";
import { ToolRegistry } from "@/application/tools/ToolRegistry";

suite("tool registry validation", () => {
  test("rejects invalid tool calls with the relevant schema error", () => {
    const registry = createRegistry();
    const cases = [
      { label: "unknown tool", call: createToolCall("missing_tool", {}), error: /Unknown tool/ },
      { label: "malformed JSON", call: { function: { name: "read_file", arguments: "{" } }, error: /Invalid JSON/ },
      { label: "missing required path", call: createToolCall("read_file", {}), error: /missing required property 'path'/ },
      { label: "unknown strict property", call: createToolCall("read_file", { path: "README.md", unexpected: true }), error: /unknown property 'unexpected'/ },
      { label: "invalid path type", call: createToolCall("read_file", { path: 1 }), error: /property 'path' must be string/ },
    ];
    for (const { label, call, error } of cases) {
      const result = registry.validate(call);
      assert.strictEqual(result.valid, false, label);
      assert.match(result.error ?? "", error, label);
    }
  });
});

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({ definition: readFileDefinition, handler: readFileHandler, metadata: readFileMetadata });
  return registry;
}

function createToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: "call_1",
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

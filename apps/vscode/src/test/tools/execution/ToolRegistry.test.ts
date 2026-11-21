import * as assert from "assert";
import type { ToolCall } from "@/contracts";
import { readFileDefinition, readFileHandler, readFileMetadata } from "@/infrastructure/tools/builtins/fileSystem/ReadFile";
import { ToolRegistry } from "@/application/tools/ToolRegistry";

suite("tool registry validation", () => {
  test("replaces registered tools without duplicating API definitions or registry size", () => {
    const registry = createRegistry(); assert.strictEqual(registry.size, 1);
    const replacement = { ...registry.get("read_file")!, handler: async () => "replacement" };
    registry.register(replacement);
    assert.strictEqual(registry.size, 1); assert.strictEqual(registry.get("read_file"), replacement);
    assert.deepStrictEqual(registry.getDefinitionsForAPI(), [replacement.definition]);
  });
  test("rejects non-object argument roots even when they contain valid JSON", () => {
    const registry = createRegistry();
    for (const args of [null, true, 1, "file.txt", []]) {
      const result = registry.validate({ function: { name: "read_file", arguments: JSON.stringify(args) } });
      assert.strictEqual(result.valid, false); assert.match(result.error ?? "", /arguments must be an object/);
    }
  });
  test("validates each supported JSON type and leaves extension types unrestricted", () => {
    for (const [type, accepted, rejected] of [
      ["string", "text", 1], ["boolean", true, "true"], ["number", 1.5, "1"],
      ["integer", 2, 1.5], ["object", {}, []], ["array", [], {}], ["custom-type", null, undefined],
    ] as const) {
      const registry = createRegistry(); const base = registry.get("read_file")!;
      registry.register({ ...base, definition: { type: "function", function: { name: "typed", parameters: { type: "object", properties: { value: { type } }, required: ["value", 17], additionalProperties: false } } } });
      assert.strictEqual(registry.validate(createToolCall("typed", { value: accepted })).valid, true, type);
      if (rejected !== undefined) {
        const result = registry.validate(createToolCall("typed", { value: rejected }));
        assert.strictEqual(result.valid, false, type); assert.match(result.error ?? "", new RegExp(`must be ${type}`));
      }
    }
  });
  test("uses an empty strict schema when parameters are absent and preserves permissive schemas", () => {
    const registry = createRegistry(); const base = registry.get("read_file")!;
    registry.register({ ...base, definition: { type: "function", function: { name: "empty" } } });
    assert.strictEqual(registry.validate(createToolCall("empty", {})).valid, true);
    assert.strictEqual(registry.validate(createToolCall("empty", { unexpected: 1 })).valid, false);
    for (const properties of [null, { value: null }, { value: { type: ["string", "null"] } }]) {
      registry.register({ ...base, definition: { type: "function", function: { name: "permissive", parameters: { properties, required: "not-an-array" } } } });
      assert.strictEqual(registry.validate(createToolCall("permissive", { value: null })).valid, true);
    }
  });
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

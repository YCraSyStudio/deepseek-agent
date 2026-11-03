import assert from "node:assert/strict";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { compactContextDefinition, compactContextHandler, compactContextMetadata } from "@/infrastructure/tools/builtins/context/CompactContext";

suite("context compaction tool contract", () => {
  test("returns continuity instructions through the registered tool without requesting mutation approval", async () => {
    const registry = new ToolRegistry(); registry.register({ definition: compactContextDefinition, handler: compactContextHandler, metadata: compactContextMetadata });
    const call = { id: "compact", type: "function" as const, function: { name: "compact_context", arguments: "{}" } };
    const result = await new ToolExecutor(registry).execute(call);
    assert.equal(result.status, "completed"); assert.match(result.outcome.content, /compacted continuation for the next round/);
    assert.match(result.outcome.content, /do not repeat completed mutations/);
    assert.equal(compactContextMetadata.effect, "read-only"); assert.equal(compactContextMetadata.requiresConfirmation, false);
    assert.equal(registry.validate({ ...call, function: { ...call.function, arguments: '{"unexpected":true}' } }).valid, false);
  });
});

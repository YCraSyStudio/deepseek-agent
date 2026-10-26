import assert from "node:assert/strict";
import { readInstructionTool } from "@/infrastructure/tools/builtins/context/ReadInstruction";

suite("read_instruction tool", () => {
  test("reads an exact id through the generation-bound reader", async () => {
    const signal = new AbortController().signal;
    const result = await readInstructionTool.handler({ id: "global:commit" }, { signal, readInstruction: async (id, passed) => {
      assert.equal(id, "global:commit");assert.equal(passed, signal);return "Commit rules";
    } });
    assert.equal(result, "Commit rules");
  });
  test("does not accept arbitrary paths without an authorized reader", async () => {
    assert.match(await readInstructionTool.handler({ id: "/etc/passwd" }), /^Error:/);
    assert.match(await readInstructionTool.handler({ id: 1 }, { readInstruction: async () => {assert.fail();} }), /^Error:/);
    assert.match(await readInstructionTool.handler({ id: "unknown" }, { readInstruction: async () => {throw new Error("Not in catalog");} }), /Not in catalog/);
  });
  test("propagates cancellation instead of returning a successful tool result", async () => {
    await assert.rejects(readInstructionTool.handler({ id: "global:commit" }, { signal: AbortSignal.abort(), readInstruction: async () => {throw new Error("cancelled");} }));
  });
});

import assert from "node:assert/strict";
import { addProvenFileScope } from "@/vscode/webviews/handlers/chat/toolCalls/execution/PipelineContext";
import { setToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { toolCall } from "./executionHarness";

suite("tool mutation path scope proofs", () => {
  let inspected: string[];
  const confirmation = { requiresConfirmation: true as const, dangerLevel: "caution" as const, warningMessage: "Review" };
  setup(() => {
    inspected = []; const unused = async (): Promise<never> => { throw new Error("Unexpected workspace IO"); };
    setToolWorkspaceHost({ getRootPath: () => "/workspace", readFile: unused, writeFile: unused, stat: unused, createParentDirectory: unused, readDirectory: unused,
      isPathInsideWorkspace: async target => { inspected.push(target); return target === "source.ts" || target === "destination.ts"; } });
  });
  test("requires both the source and destination of a move to be contained", async () => {
    const inside = await addProvenFileScope(toolCall("move_path", { path: "source.ts", destination: "destination.ts" }), confirmation);
    assert.equal(inside.workspaceContained, true); assert.equal(inside.workspaceRoot, "/workspace"); assert.deepEqual(inspected, ["source.ts", "destination.ts"]);
    const outside = await addProvenFileScope(toolCall("move_path", { path: "source.ts", destination: "/outside/destination.ts" }), confirmation);
    assert.equal(outside.workspaceContained, false); assert.equal(outside.reasonCode, "outside-workspace");
  });
  test("does not infer containment from missing, malformed or empty destination arguments", async () => {
    for (const destination of [undefined, 1, "", " "]) {
      const result = await addProvenFileScope(toolCall("move_path", { path: "source.ts", destination }), confirmation);
      assert.equal(result.workspaceContained, false); assert.equal(result.reasonCode, "outside-workspace");
    }
    const invalid = toolCall("move_path", {}); invalid.function.arguments = "{";
    assert.equal((await addProvenFileScope(invalid, { ...confirmation, filePath: "source.ts" })).workspaceContained, false);
  });
  test("preserves non-mutation confirmations and does not request an unnecessary destination", async () => {
    assert.equal(await addProvenFileScope(toolCall("read_file", { path: "source.ts" }), confirmation), confirmation);
    const file = await addProvenFileScope(toolCall("edit_file", { path: "source.ts" }), confirmation);
    assert.equal(file.workspaceContained, true); assert.deepEqual(inspected, ["source.ts"]);
  });
});

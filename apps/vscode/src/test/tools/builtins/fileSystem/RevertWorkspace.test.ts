import assert from "node:assert/strict";
import { revertWorkspaceTool } from "@/infrastructure/tools/builtins/fileSystem/RevertWorkspace";

suite("revert_workspace tool", () => {
  test("uses the normal confirmation flow and calls the shared restore operation after authorization", async () => {
    const prepared = JSON.parse(await revertWorkspaceTool.handler({}));
    assert.equal(prepared.requiresConfirmation, true);
    let selected: string | undefined;
    const result = await revertWorkspaceTool.forcedHandler!({ generationId: "turn-1" }, {
      revertWorkspace: async (generationId) => {selected = generationId; return "Reverted turn-1";},
    });
    assert.equal(selected, "turn-1");
    assert.equal(result, "Reverted turn-1");
  });
  test("fails without a scoped restore operation or with a malicious turn id", async () => {
    assert.match(await revertWorkspaceTool.forcedHandler!({}), /unavailable/);
    assert.match(await revertWorkspaceTool.forcedHandler!({ generationId: "../other-chat" }, { revertWorkspace: async () => "must not run" }), /invalid/);
  });
});

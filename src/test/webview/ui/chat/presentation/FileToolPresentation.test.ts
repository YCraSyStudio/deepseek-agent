import * as assert from "node:assert";
import {
  getToolCallFileChange,
  getToolCallFilePath,
  isEditorFileTool,
} from "@webview/components/chatView/tools/results/FileToolPresentation";

suite("file tool presentation", () => {
  test("offers the editor action only for tools with an explicit affected file", () => {
    for (const toolName of ["read_file", "create_file", "edit_file", "apply_patch"]) {
      assert.strictEqual(isEditorFileTool(toolName), true);
      assert.strictEqual(
        getToolCallFilePath({ toolName, arguments: '{"path":"src/App.ts"}' }),
        "src/App.ts",
      );
    }
    assert.strictEqual(
      getToolCallFilePath({ toolName: "list_directory", arguments: '{"path":"src"}' }),
      undefined,
    );
    assert.strictEqual(
      getToolCallFilePath({ toolName: "edit_file", arguments: "invalid" }),
      undefined,
    );
  });

  test("offers an exact saved diff for completed file-writing tools", () => {
    const diff = "--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1,1 +1,1 @@\n-old\n+new";
    const edit = getToolCallFileChange({
      toolName: "edit_file",
      status: "completed",
      result: JSON.stringify({
        toolResultVersion: 1,
        type: "fileEdit",
        path: "src/App.ts",
        diff,
        diffTruncated: false,
        summary: "Edited",
      }),
    });
    assert.deepStrictEqual(edit, { path: "src/App.ts", diff });
  });

  test("does not offer an incomplete, mismatched or failed change", () => {
    const result = JSON.stringify({
      toolResultVersion: 1,
      type: "fileEdit",
      path: "src/App.ts",
      diff: "--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
      diffTruncated: true,
      summary: "Edited",
    });
    assert.strictEqual(getToolCallFileChange({ toolName: "edit_file", status: "completed", result }), undefined);
    assert.strictEqual(getToolCallFileChange({ toolName: "apply_patch", status: "completed", result }), undefined);
    assert.strictEqual(getToolCallFileChange({ toolName: "edit_file", status: "error", result }), undefined);
  });
});

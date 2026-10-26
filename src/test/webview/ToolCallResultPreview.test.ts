import * as assert from "node:assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToolCallResultPreview } from "@webview/components/chatView/tools/results/ToolCallResultPreview";
import { renderToolCallArgumentsPreview } from "@webview/components/chatView/tools/results/ToolCallResultRenderers";
import type { ToolCallState } from "@webview/views/chatView/ChatViewTypes";

suite("tool call result presentation", () => {
  test("does not render successful read_file content in the chat", () => {
    const result = JSON.stringify({
      toolResultVersion: 1,
      type: "file",
      path: "src/large.ts",
      size: 100_000,
      content: "private file content that belongs in the editor",
    });

    assert.strictEqual(renderToolCallResultPreview({
      toolCall: createReadCall("completed", result),
      vscode: null,
    }), null);
  });

  test("keeps failed read_file results visible", () => {
    const rendered = renderToolCallResultPreview({
      toolCall: createReadCall("error", "Error reading file: permission denied"),
      vscode: null,
    });

    assert.ok(React.isValidElement(rendered));
  });

  test("moves successful edit diffs out of the chat and keeps failures visible", () => {
    for (const toolName of ["edit_file", "apply_patch"]) {
      assert.strictEqual(renderToolCallResultPreview({
        toolCall: { ...createReadCall("completed", "unused"), toolName },
        vscode: null,
      }), null);
      assert.ok(React.isValidElement(renderToolCallResultPreview({
        toolCall: { ...createReadCall("error", "Error editing file: search text not found"), toolName },
        vscode: null,
      })), toolName);
    }
  });

  test("shows only the affected path for file-tool arguments", () => {
    const markup = renderToStaticMarkup(renderToolCallArgumentsPreview(
      "edit_file",
      JSON.stringify({
        path: "backend/Program.cs",
        search: "old private content",
        replace: "new private content",
      }),
    ));

    assert.match(markup, /\.\/backend\/Program\.cs/);
    assert.doesNotMatch(markup, /old private content|new private content/);
  });
});

function createReadCall(status: ToolCallState["status"], result: string): ToolCallState {
  return {
    toolCallId: "read-1",
    toolName: "read_file",
    arguments: '{"path":"src/large.ts"}',
    status,
    result,
    round: 1,
  };
}

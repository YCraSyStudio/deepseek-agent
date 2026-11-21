import * as assert from "node:assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToolCallResultPreview } from "@webview/components/chatView/tools/results/ToolCallResultPreview";
import { renderToolCallArgumentsPreview } from "@webview/components/chatView/tools/results/ToolCallResultRenderers";
import type { ToolCallState } from "@webview/views/chatView/ChatViewTypes";

suite("tool call result presentation", () => {
  const diff = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new";
  const markup = (result: unknown, toolName = "custom_tool", status: ToolCallState["status"] = "completed") =>
    renderToStaticMarkup(renderToolCallResultPreview({ toolCall: { ...createReadCall(status, typeof result === "string" ? result : JSON.stringify(result)), toolName }, vscode: null }));
  test("omits missing results and retains escaped plain errors", () => {
    assert.strictEqual(renderToolCallResultPreview({ toolCall: createReadCall("running", ""), vscode: null }), null);
    assert.match(markup("<script>failure</script>"), /&lt;script&gt;failure&lt;\/script&gt;/);
    assert.match(markup("not a terminal envelope", "run_terminal_command", "error"), /not a terminal envelope/);
  });
  for (const binary of [false, true]) {
    test(`renders a structured file preview with binary=${binary}`, () => {
      const output = markup({ toolResultVersion: 1, type: "file", path: "src/a.ts", content: "const value = 1", size: 15, binary });
      assert.match(output, /a.ts/);
      if (binary) { assert.doesNotMatch(output, /const value/); assert.match(output, /binary/i); }
      else { assert.match(output.replace(/<[^>]+>/g, ""), /const value = 1/); }
    });
  }
  test("renders structured search matches and their truncation notice", () => {
    const output = markup({ toolResultVersion: 1, type: "SearchResults", query: "needle", results: [{ file: "src/a.ts", line: 7, text: "needle <tag>" }], truncated: true });
    assert.match(output, /src\/a.ts/); assert.match(output, /needle &lt;tag&gt;/); assert.match(output, /searchResultMore/);
  });
  for (const withDiff of [false, true]) {
    test(`renders file-write summaries with diff=${withDiff}`, () => {
      const output = markup({ toolResultVersion: 1, type: "fileWrite", path: "src/a.ts", summary: "Saved file", overwritten: true,
        ...(withDiff ? { diff, diffStats: { additions: 1, deletions: 1 }, diffTruncated: true } : { binary: true }), beforeSize: 3, afterSize: 4 });
      assert.match(output, /Saved file/); assert.match(output, withDiff ? /diffPreview/ : /writePreview/);
      if (withDiff) { assert.match(output, /old/); assert.match(output, /new/); }
    });
  }
  test("does not duplicate a structured create-file result even on non-completed calls", () => {
    assert.strictEqual(markup({ toolResultVersion: 1, type: "fileWrite", path: "src/a.ts", summary: "Created", overwritten: false }, "create_file", "error"), "");
  });
  for (const type of ["fileEdit", "filePatch"] as const) {
    test(`renders ${type} metadata and exact diff lines`, () => {
      const output = markup({ toolResultVersion: 1, type, path: "src/a.ts", summary: "Updated file", diff, diffStats: { additions: 1, deletions: 1 }, diffTruncated: true, beforeSize: 3, afterSize: 4 });
      assert.match(output, /Updated file/); assert.match(output, /diffPreview/); assert.match(output, /old/); assert.match(output, /new/);
    });
  }
  for (const type of ["fileMove", "fileDelete"] as const) {
    test(`renders ${type} as a path and summary`, () => {
      const output = markup({ toolResultVersion: 1, type, path: "src/a.ts", destination: "src/b.ts", sourceKind: "file", entryType: "file", permanent: false, summary: "Operation done" });
      assert.match(output, /src\/a.ts/); assert.match(output, /Operation done/);
    });
  }
  test("renders legacy searches and raw create-file diffs", () => {
    assert.match(markup("src/a.ts:7: needle", "search_content"), /needle/);
    assert.match(markup(diff, "create_file", "error"), /diffPreview/);
  });

  test("renders application sessions as terminal output without JSON truncation", () => {
    const stdout = "startup line\n".repeat(120) + "READY_AT_END";
    const result = { kind: "application_session", sessionId: "session-1", status: "running",
      command: "npm run dev", cwd: "/project/web-doc", pid: 123, stdout, stderr: "warning line",
      exitCode: null, signal: null, timedOut: false, truncated: { stdout: false, stderr: false }, note: "running" };
    const markup = renderToStaticMarkup(renderToolCallResultPreview({
      toolCall: { ...createReadCall("completed", JSON.stringify(result)), toolName: "application_session" }, vscode: null,
    }));
    assert.match(markup, /terminalResult/);
    assert.match(markup, /Running/);
    assert.match(markup, /npm run dev/);
    assert.match(markup, /project\/web-doc/);
    assert.match(markup, /READY_AT_END/);
    assert.match(markup, /warning line/);
    assert.doesNotMatch(markup, /exit unknown|commandCompletedWithoutOutput|&quot;kind&quot;/);
    const stopped = renderToStaticMarkup(renderToolCallResultPreview({
      toolCall: { ...createReadCall("completed", JSON.stringify({ ...result, status: "stopped", terminationConfirmed: true, signal: "SIGTERM" })), toolName: "application_session" }, vscode: null,
    }));
    assert.match(stopped, /Stopped/);
    assert.match(stopped, /terminalOutcome success/);
  });

  test("terminal argument previews show commands instead of a fictitious JSON filename", () => {
    for (const tool of ["application_session", "run_terminal_command"]) {
      const markup = renderToStaticMarkup(renderToolCallArgumentsPreview(tool, '{"command":"echo hola"}'));
      assert.match(markup, /echo hola/);
      assert.doesNotMatch(markup, /\.json/);
    }
  });

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

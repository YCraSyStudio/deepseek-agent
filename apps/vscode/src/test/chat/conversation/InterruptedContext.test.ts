import * as assert from "assert";
import type { StoredToolCall } from "@/contracts";
import { buildInterruptedContextContent } from "@/application/chat/InterruptedContext";

suite("interrupted execution context", () => {
  test("keeps bounded operation metadata without raw file content or diffs", () => {
    const calls: StoredToolCall[] = [
      {
        toolCallId: "read",
        toolName: "read_file",
        arguments: JSON.stringify({ path: "src/app.ts" }),
        result: JSON.stringify({ type: "file", path: "src/app.ts", sha256: "abc", content: "RAW_SECRET_FILE_BODY" }),
        status: "completed",
      },
      {
        toolCallId: "search",
        toolName: "search_content",
        arguments: JSON.stringify({ query: "Migrator", filePattern: "src/**" }),
        result: JSON.stringify({ type: "SearchResults", results: [{ file: "src/app.ts", line: 1, text: "RAW_MATCH_BODY" }] }),
        status: "completed",
      },
      {
        toolCallId: "edit",
        toolName: "edit_file",
        arguments: JSON.stringify({ path: "src/app.ts", search: "RAW_SEARCH", replace: "RAW_REPLACEMENT" }),
        result: JSON.stringify({ type: "fileEdit", summary: "Edited src/app.ts", beforeHash: "before", afterHash: "after", diff: "RAW_DIFF" }),
        status: "completed",
      },
    ];
    for (let index = 0; index < 150; index += 1) {
      calls.push({
        toolCallId: `read-${index}`,
        toolName: "read_file",
        arguments: JSON.stringify({ path: `src/file-${index}.ts` }),
        result: JSON.stringify({ type: "file", sha256: `${index}`, content: "x".repeat(1_000) }),
        status: "completed",
      });
    }

    const context = buildInterruptedContextContent("Visible partial response", calls)!;

    assert.ok(context.length <= 8 * 1024);
    assert.match(context, /Visible partial response/);
    assert.match(context, /src\/app\.ts/);
    assert.match(context, /matchedFiles/);
    assert.doesNotMatch(context, /RAW_SECRET_FILE_BODY|RAW_MATCH_BODY|RAW_DIFF|RAW_SEARCH|RAW_REPLACEMENT/);
  });

  test("redacts sensitive command values", () => {
    const context = buildInterruptedContextContent("", [{
      toolCallId: "terminal",
      toolName: "run_terminal_command",
      arguments: JSON.stringify({ command: "tool --api-key=secret-value", cwd: "." }),
      result: "done",
      status: "completed",
    }])!;

    assert.doesNotMatch(context, /secret-value/);
    assert.match(context, /REDACTED/);
  });
});

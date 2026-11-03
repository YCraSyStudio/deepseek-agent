import * as assert from "node:assert";
import { collectTurnFileEdits } from "@webview/components/chatView/tools/results/FileEditSummary";
import type { ToolCallGroup, ToolCallState } from "@webview/views/chatView/ChatViewTypes";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

suite("turn file edit summary", () => {
  test("lists each edited file once and adds up every change in the turn", () => {
    const edits = collectTurnFileEdits([
      group(1, [
        toolCall("edit_file", editResult({ diffStats: { additions: 2, deletions: 1 }, beforeHash: HASH_A, afterHash: HASH_B })),
        toolCall("read_file", JSON.stringify({ toolResultVersion: 1, type: "file", path: "src/App.ts", content: "text", size: 4 })),
      ]),
      group(2, [
        toolCall("apply_patch", patchResult({ diffStats: { additions: 3, deletions: 0 }, afterHash: HASH_C })),
        toolCall("create_file", writeResult()),
      ]),
    ]);

    assert.deepStrictEqual(edits, [
      {
        path: "src/App.ts",
        additions: 5,
        deletions: 1,
        diff: "--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
        beforeHash: HASH_A,
        afterHash: HASH_C,
      },
      {
        path: "docs/README.md",
        additions: 1,
        deletions: 0,
        diff: "--- a/docs/README.md\n+++ b/docs/README.md\n@@ -1,1 +1,1 @@\n-old\n+new",
        beforeHash: undefined,
        afterHash: HASH_C,
      },
    ]);
  });

  test("keeps large edits that only expose document hashes", () => {
    const edits = collectTurnFileEdits([
      group(1, [toolCall("edit_file", editResult({ diff: "--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1,1 +1,1 @@\n-old\n+new", diffTruncated: true }))]),
    ]);

    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0]?.diff, undefined);
    assert.strictEqual(edits[0]?.afterHash, HASH_B);
  });

  test("ignores unfinished, mismatched and unrelated tool calls", () => {
    const edits = collectTurnFileEdits([
      group(1, [
        toolCall("edit_file", editResult(), "error"),
        toolCall("edit_file", editResult(), "rejected"),
        toolCall("create_file", editResult()),
        toolCall("run_terminal_command", JSON.stringify({ toolResultVersion: 1, type: "fileEdit", path: "src/App.ts", diff: "@@ -1,1 +1,1 @@\n-a\n+b", afterHash: HASH_B })),
        toolCall("edit_file", JSON.stringify({ toolResultVersion: 1, type: "fileEdit", path: "", diff: "@@ -1,1 +1,1 @@\n-a\n+b", afterHash: HASH_B })),
      ]),
    ]);

    assert.deepStrictEqual(edits, []);
  });
});

function group(round: number, toolCalls: ToolCallState[]): ToolCallGroup {
  return { id: `group-${round}`, round, expanded: false, toolCalls };
}

function toolCall(toolName: string, result: string, status: ToolCallState["status"] = "completed"): ToolCallState {
  return {
    toolCallId: `${toolName}-${status}-${result.length}`,
    toolName,
    arguments: "{}",
    status,
    result,
    round: 1,
  };
}

function editResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    toolResultVersion: 1,
    type: "fileEdit",
    path: "src/App.ts",
    diff: "--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
    diffTruncated: false,
    diffStats: { additions: 1, deletions: 1 },
    beforeHash: HASH_A,
    afterHash: HASH_B,
    summary: "Edited src/App.ts",
    ...overrides,
  });
}

function patchResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    toolResultVersion: 1,
    type: "filePatch",
    path: "src/App.ts",
    diff: "--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
    diffTruncated: false,
    diffStats: { additions: 1, deletions: 1 },
    afterHash: HASH_B,
    summary: "Patched src/App.ts",
    ...overrides,
  });
}

function writeResult(): string {
  return JSON.stringify({
    toolResultVersion: 1,
    type: "fileWrite",
    path: "docs/README.md",
    diff: "--- a/docs/README.md\n+++ b/docs/README.md\n@@ -1,1 +1,1 @@\n-old\n+new",
    diffTruncated: false,
    diffStats: { additions: 1, deletions: 0 },
    overwritten: false,
    afterHash: HASH_C,
    summary: "File created: docs/README.md",
  });
}

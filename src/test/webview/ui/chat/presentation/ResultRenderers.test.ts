import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import {
  renderStructuredFilePreview, renderToolCallArgumentsPreview, renderWriteSummary, renderDiffPreview,
  renderPlainResult, renderSearchPreview, renderSearchResults, renderTerminalResult,
} from "@webview/components/chatView/tools/results/ToolCallResultRenderers";
import type { TerminalCommandResult } from "@webview/views/chatView/utils/FilePreviewTypes";
import type { ApplicationSessionResult } from "@/contracts/ApplicationSession";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

suite("tool result renderer behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => { h = await createDomHarness(); setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  const render = (node: ReactNode) => h.render(createElement("div", null, node));

  test("file previews preserve filename, syntax tokens, metadata and line boundaries", async () => {
    const content = 'const value = "text"; // comment\n# other comment\nreturn 42;\n\nplain';
    await render(renderStructuredFilePreview({ toolResultVersion: 1, type: "file", path: "src/example.ts", size: 512, content }));
    assert.equal(h.query(".filePreviewName").textContent, "example.ts");
    assert.ok(h.container.querySelector(".syntaxKeyword")); assert.ok(h.container.querySelector(".syntaxString"));
    assert.ok(h.container.querySelector(".syntaxComment")); assert.ok(h.container.querySelector(".syntaxNumber"));
    assert.equal(h.container.querySelectorAll(".codeLine").length, 5);
    assert.match(h.query("code").textContent!, /plain/);
  });

  test("binary files never expose their contents", async () => {
    await render(renderStructuredFilePreview({ toolResultVersion: 1, type: "file", path: "assets/image.png", size: 2048, content: "PRIVATE_BINARY", binary: true }));
    assert.ok(h.container.querySelector(".binaryPreview")); assert.match(h.container.textContent!, /image.png/);
    assert.doesNotMatch(h.container.textContent!, /PRIVATE_BINARY/);
  });

  for (const previewSize of [undefined, 20]) {
    test(`truncated files expose a bounded preview notice, explicit size=${previewSize}`, async () => {
      await render(renderStructuredFilePreview({ toolResultVersion: 1, type: "file", path: "file.unknown", size: 9999, content: "start", truncated: true, previewSize }));
      assert.match(h.query(".filePreviewNotice").textContent!, /first/i);
      assert.match(h.container.textContent!, /truncated/i);
    });
  }

  for (const args of ["not JSON", "null", "[]", "42", '"text"']) {
    test(`invalid argument payloads are shown as bounded text: ${args}`, async () => {
      await render(renderToolCallArgumentsPreview("custom", args));
      assert.equal(h.query(".filePreviewName").textContent, "arguments.txt"); assert.match(h.query("code").textContent!, new RegExp(args.replace(/[\[\]]/g, "\\$&")));
    });
  }

  test("oversized invalid payloads and ordinary results are truncated with explicit lengths", async () => {
    await render(renderToolCallArgumentsPreview("custom", "x".repeat(5000)));
    assert.match(h.query("code").textContent!, /truncated, 5000 chars/); assert.ok(h.query("code").textContent!.length < 4200);
    await render(renderPlainResult("result".repeat(300), "error"));
    assert.equal(h.query<HTMLDetailsElement>("details").open, true); assert.ok(h.container.querySelector(".errorText"));
    assert.match(h.query("pre").textContent!, /truncated, 1800 chars/);
    await render(renderPlainResult("small success", "completed")); assert.equal(h.query<HTMLDetailsElement>("details").open, false);
  });

  for (const payload of [{ command: "npm test" }, { action: "stop", session_id: "session-1" }, {}]) {
    test(`application arguments display command or action/session identity: ${JSON.stringify(payload)}`, async () => {
      await render(renderToolCallArgumentsPreview("application_session", JSON.stringify(payload)));
      assert.equal(h.query(".terminalCommand").textContent, "command" in payload ? payload.command : "action" in payload ? "stop session-1" : "");
    });
  }

  const fileArguments: Array<[Record<string, unknown>, string]> = [
    [{ path: "src\\file.ts", offset: 3, limit: 5 }, "./src/file.ts :: lines 3-7"],
    [{ path: "file.ts", offset: 3 }, "./file.ts :: from line 3"],
    [{ path: "./file.ts", limit: 8 }, "./file.ts :: first 8 lines"],
    [{ path: "/", offset: -1, limit: 1.5 }, "./"],
    [{ path: "../file.ts" }, "[invalid workspace path]"],
    [{ path: "C:\\outside.ts" }, "[invalid workspace path]"],
  ];
  for (const [args, text] of fileArguments) {
    test(`read previews describe normalized paths and ranges: ${JSON.stringify(args)}`, async () => {
      await render(renderToolCallArgumentsPreview("read_file", JSON.stringify(args)));
      assert.ok(h.query(".toolCallSummaryPreview").textContent!.includes(text));
    });
  }

  test("symbol previews filter requested names and do not reveal editor file contents", async () => {
    await render(renderToolCallArgumentsPreview("read_func", JSON.stringify({ path: "file.ts", names: [" first ", 1, "", " ", "second", "third", "fourth", "fifth", "sixth", "seventh"], content: "PRIVATE_FILE" })));
    assert.equal(h.query(".toolCallSummaryPreview").textContent, "./file.ts :: first, second, third, fourth, fifth, sixth");
    assert.doesNotMatch(h.container.textContent!, /PRIVATE_FILE|seventh/);
    await render(renderToolCallArgumentsPreview("read_func", JSON.stringify({ path: "file.ts", names: [" ", false] })));
    assert.equal(h.query(".toolCallSummaryPreview").textContent, "./file.ts");
  });

  test("directory arguments default to the workspace root", async () => {
    await render(renderToolCallArgumentsPreview("list_directory", "{}")); assert.match(h.query(".toolCallSummaryPreview").textContent!, /\.\//);
    await render(renderToolCallArgumentsPreview("list_directory", '{"path":"src"}')); assert.match(h.query(".toolCallSummaryPreview").textContent!, /\.\/src/);
  });

  for (const [name, payload, expected] of [
    ["custom", { content: "provided content" }, "provided content"],
    ["edit_file", { replace: "replacement" }, "replacement"],
    ["custom", { command: "tool command" }, "tool command"],
    ["search_content", { query: "needle" }, "needle"],
    ["custom", { other: "metadata" }, '"other"'],
    ["custom", { path: "dir/script.py", content: "print(1)" }, "print(1)"],
  ] as const) {
    test(`argument previews prefer the appropriate content for ${JSON.stringify(payload)}`, async () => {
      await render(renderToolCallArgumentsPreview(name, JSON.stringify(payload)));
      assert.ok(h.query("code").textContent!.includes(expected));
    });
  }

  test("oversized content and JSON arguments are bounded independently", async () => {
    await render(renderToolCallArgumentsPreview("custom", JSON.stringify({ content: "x".repeat(9000) })));
    assert.match(h.query("code").textContent!, /truncated, 9000 chars/);
    await render(renderToolCallArgumentsPreview("custom", JSON.stringify({ other: "x".repeat(5000) })));
    assert.match(h.query("code").textContent!, /truncated/);
  });

  test("write summaries distinguish binary changes without dumping contents", async () => {
    await render(renderWriteSummary("Updated file", "file.bin", { binary: true, beforeSize: 1, afterSize: 2 }));
    assert.match(h.container.textContent!, /Updated file/); assert.ok(h.container.querySelector(".filePreviewNotice"));
    await render(renderWriteSummary("Updated text", "file.txt")); assert.equal(h.container.querySelector(".filePreviewNotice"), null);
  });

  test("diffs preserve headers, hunk positions, counts, context and truncation notes", async () => {
    const diff = '--- a/file\n+++ b/file\n@@ -3,2 +7,2 @@\n keep\n-old\n+new\n... diff truncated';
    await render(renderDiffPreview(diff, { path: "file.ts", afterSize: 4096 }));
    assert.ok(h.container.querySelector(".diffHeader")); assert.ok(h.container.querySelector(".diffHunk"));
    assert.ok(h.container.querySelector(".diffContext")); assert.ok(h.container.querySelector(".diffNote"));
    assert.equal(h.query(".diffRemove .diffLineNumber").textContent, "4");
    assert.equal(h.query(".diffAdd .diffLineNumber:nth-child(2)").textContent, "8");
    assert.match(h.query(".filePreviewHeader").textContent!, /file.ts\+1-1/);
    assert.ok(h.container.querySelector(".filePreviewNotice"));
    await render(renderDiffPreview("+new", "Readable summary")); assert.match(h.query(".filePreviewName").textContent!, /Readable summary/);
    await render(renderDiffPreview("-old", { summary: "Explicit", stats: { additions: 5, deletions: 6 }, truncated: true }));
    assert.match(h.query(".filePreviewHeader").textContent!, /Explicit\+5-6/);
    await render(renderDiffPreview(" unchanged")); assert.ok(h.query(".filePreviewName").textContent!.length > 0);
  });

  test("search hits open their exact file and line and retain a bounded list", async () => {
    const posts: unknown[] = [];
    const api = { postMessage: (post: unknown) => posts.push(post), getState: <T,>() => undefined as T | undefined, setState: <T,>(value: T) => value };
    const results = Array.from({ length: 32 }, (_, index) => ({ file: `src/file-${index}.ts`, line: index + 1, text: `hit ${index}` }));
    await render(renderSearchResults(results, api)); assert.equal(h.container.querySelectorAll(".searchResultItem").length, 30);
    await h.click(".searchResultItem"); assert.deepEqual(posts, [{ type: "openFile", path: "src/file-0.ts", line: 1 }]);
    assert.match(h.query(".searchResultMore").textContent!, /2/);
    await render(renderSearchResults(results.slice(0, 1), null, true)); await h.click(".searchResultItem"); assert.ok(h.container.querySelector(".searchResultMore"));
    await render(renderSearchResults([], null)); assert.equal(h.container.querySelector(".searchResultMore"), null);
  });

  for (const status of ["error", "completed"]) {
    test(`unstructured search output preserves its ${status} status`, async () => {
      await render(renderSearchPreview("message".repeat(200), status, null));
      assert.equal(h.query<HTMLDetailsElement>("details").open, status === "error"); assert.match(h.query("pre").textContent!, /\.\.\./);
    });
  }
  test("legacy text search hits retain click targets", async () => {
    await render(renderSearchPreview("src/file.ts:12: found here", "completed", null));
    assert.equal(h.query(".searchResultLine").textContent, ":12");
  });

  for (const patch of [{ durationMs: 5 }, { durationMs: 1500, exitCode: 1 }, { timedOut: true }, { cancelled: true }, { exitCode: null, signal: "SIGTERM", truncated: { stdout: true, stderr: true } }] as const) {
    test(`terminal output preserves status and command metadata: ${JSON.stringify(patch)}`, async () => {
      await render(renderTerminalResult(terminal(patch)));
      assert.match(h.query(".terminalMetadata").textContent!, /project/); assert.match(h.query(".terminalCommand").textContent!, /npm test/);
      assert.ok(h.container.querySelector(".filePreviewNotice"));
    });
  }

  for (const status of ["running", "stopped", "exited"] as const) {
    test(`application sessions report ${status} without command-only metadata`, async () => {
      const result = { kind: "application_session", sessionId: "session-1", status, command: "npm run dev", cwd: "/project", pid: 123, stdout: "", stderr: "", exitCode: null, signal: null, timedOut: false, terminationConfirmed: status === "stopped", truncated: { stdout: false, stderr: false } } as ApplicationSessionResult;
      await render(renderTerminalResult(result)); assert.match(h.query(".terminalMetadata").textContent!, /PID 123/);
      assert.ok(h.container.querySelector(`.terminalOutcome.${status === "running" ? "running" : status === "stopped" ? "success" : "failure"}`));
    });
  }

  test("retained terminal output can be expanded without losing the omitted suffix", async () => {
    const stdout = "out".repeat(6000) + "FINAL_STDOUT";
    const stderr = "err".repeat(6000) + "FINAL_STDERR";
    await render(renderTerminalResult(terminal({ stdout, stderr })));
    assert.equal(h.container.querySelectorAll("textarea").length, 0);
    const retained = h.container.querySelectorAll<HTMLDetailsElement>(".terminalStream > details");
    for (const details of retained) {
      await h.click(details.querySelector("summary")!);
      await h.flush();
    }
    assert.equal(h.container.querySelectorAll("textarea").length, 2);
    assert.ok([...h.container.querySelectorAll<HTMLTextAreaElement>("textarea")].some((element) => element.value.endsWith("FINAL_STDOUT")));
    assert.ok([...h.container.querySelectorAll<HTMLTextAreaElement>("textarea")].some((element) => element.value.endsWith("FINAL_STDERR")));
  });
});

function terminal(patch: Partial<TerminalCommandResult> = {}): TerminalCommandResult {
  return { kind: "command_result", command: "npm test", cwd: "/project", shell: "/bin/bash", stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false, cancelled: false, durationMs: 5, truncated: { stdout: false, stderr: false }, ...patch };
}

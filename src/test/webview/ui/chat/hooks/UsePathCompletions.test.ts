import assert from "node:assert/strict";
import { act, createElement, useRef, useState } from "react";
import type { PathCompletionItem } from "@/contracts";
import { usePathCompletions } from "@/ui/views/chatView/sections/inputArea/inputCtrl/UsePathCompletions";
import type { VsCodeApi } from "@/ui/VsCodeApi";
import { createDomHarness } from "../../../../support/DomHarness";

suite("path completion hook observable behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let current: ReturnType<typeof usePathCompletions>; let input: string;
  let posts: Array<Record<string, unknown>>; let bridge: VsCodeApi;
  const file: PathCompletionItem = { type: "file", label: "app.ts", path: "./src/app.ts" };
  const directory: PathCompletionItem = { type: "directory", label: "src", path: "./src/" };
  const instruction: PathCompletionItem = { type: "instruction", label: "guide", path: "./guide", instructionId: "guide", instructionScope: "workspace", description: "Guide" };
  function Probe({ conversation = "chat", revision = "revision", host = true, textarea = true, initial = "Read ./s please" }: { conversation?: string; revision?: string; host?: boolean; textarea?: boolean; initial?: string }) {
    const [value, setValue] = useState(initial); const ref = useRef<HTMLTextAreaElement | null>(null); input = value;
    current = usePathCompletions({ input: value, setInput: setValue, textareaRef: ref, vscode: host ? bridge : null, conversationId: conversation, workspaceRevision: revision });
    return textarea ? createElement("textarea", { ref, value, readOnly: true }) : createElement("span", null, value);
  }
  setup(async () => {
    h = await createDomHarness(); posts = []; bridge = { postMessage: (message) => { posts.push(message as Record<string, unknown>); }, getState: () => undefined, setState: (state) => state };
  });
  teardown(async () => { await h.dispose(); });
  async function request(value = "Read ./s please", cursor = 8, immediate = true) { await act(async () => { current.requestPathCompletions(value, cursor, immediate); }); }
  async function response(items: PathCompletionItem[], overrides: Record<string, unknown> = {}) {
    await h.message({ type: "pathCompletions", requestId: posts.at(-1)?.requestId, query: "./s", workspaceRevision: "revision", items, ...overrides });
  }
  async function settle(milliseconds = 25) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, milliseconds)); }); }

  test("sends correlated immediate requests and deduplicates unchanged queries", async () => {
    await h.render(createElement(Probe)); await request(); await request();
    assert.deepEqual(posts, [{ type: "getPathCompletions", requestId: posts[0].requestId, query: "./s", conversationId: "chat", workspaceRevision: "revision" }]);
    assert.deepEqual(current.pathToken, { start: 5, end: 8, query: "./s" }); assert.equal(current.hasCompletionResponse, false);
  });
  test("debounces changed queries and cancels earlier timers", async () => {
    await h.render(createElement(Probe)); await request("./s", 3, false); await request("./sr", 4, false);
    assert.equal(posts.length, 0); await settle(165); assert.equal(posts.length, 1); assert.equal(posts[0].query, "./sr");
  });
  test("ignores unrelated, stale and wrong-workspace messages and orders unique completions", async () => {
    await h.render(createElement(Probe)); await request();
    await response([file], { type: "other" }); await response([file], { requestId: -1 }); await response([file], { workspaceRevision: "old" });
    assert.deepEqual(current.completions, []);
    const globalInstruction = { ...instruction, path: "./global", instructionScope: "global" as const };
    await response([globalInstruction, instruction, file, file, directory]);
    assert.deepEqual(current.completions, [file, directory, instruction, globalInstruction]); assert.equal(current.hasCompletionResponse, true);
    await act(async () => { current.setActiveIndex(2); }); assert.equal(current.activeIndex, 2);
    await response([file]); assert.equal(current.activeIndex, 0);
  });
  test("inserts a file into the token, preserving surrounding text and restoring the caret", async () => {
    await h.render(createElement(Probe)); await request(); await response([file]);
    await act(async () => { current.insertCompletion(file); }); await settle();
    assert.equal(input, "Read ./src/app.ts please"); assert.equal(current.pathToken, null); assert.deepEqual(current.completions, []);
    const textarea = h.query<HTMLTextAreaElement>("textarea"); assert.equal(textarea.selectionStart, 17); assert.equal(document.activeElement, textarea);
  });
  test("instruction insertion adds a separating space", async () => {
    await h.render(createElement(Probe, { initial: "./s" })); await request("./s", 3);
    await act(async () => { current.insertCompletion(instruction); }); await settle(); assert.equal(input, "./guide "); assert.equal(current.pathToken, null);
  });
  test("directory insertion immediately requests its children", async () => {
    await h.render(createElement(Probe)); await request(); await act(async () => { current.insertCompletion(directory); }); await settle();
    assert.equal(input, "Read ./src/ please"); assert.equal(posts.length, 2); assert.equal(posts[1].query, "./src/"); assert.equal(current.pathToken?.query, "./src/");
  });
  test("does nothing on insertion without a token and supports a detached textarea", async () => {
    await h.render(createElement(Probe, { textarea: false })); await act(async () => { current.insertCompletion(file); }); assert.equal(input, "Read ./s please");
    await request(); await act(async () => { current.insertCompletion(file); }); await settle(); assert.equal(input, "Read ./src/app.ts please");
  });
  test("clearing cancels pending requests and invalidates late responses", async () => {
    await h.render(createElement(Probe)); await request(); const staleId = posts[0].requestId;
    await request("./new", 5, false); await act(async () => { current.clearCompletions(); });
    await response([file], { requestId: staleId }); await settle(165); assert.equal(posts.length, 1); assert.deepEqual(current.completions, []); assert.equal(current.hasCompletionResponse, false);
  });
  test("leaving a path token invalidates results and permits the same query again", async () => {
    await h.render(createElement(Probe)); await request(); await response([file]); await request("plain text", 10);
    assert.equal(current.pathToken, null); assert.equal(current.hasCompletionResponse, false); assert.deepEqual(current.completions, []);
    await request(); assert.equal(posts.length, 2);
  });
  test("conversation and workspace changes clear suggestions", async () => {
    await h.render(createElement(Probe)); await request(); await response([file]);
    await h.render(createElement(Probe, { conversation: "another" })); assert.deepEqual(current.completions, []);
    await request(); await response([file]); await h.render(createElement(Probe, { conversation: "another", revision: "next" })); assert.equal(current.pathToken, null);
  });
  test("works without a host or a workspace revision", async () => {
    await h.render(createElement(Probe, { host: false })); await request(); assert.equal(posts.length, 0); assert.deepEqual(current.completions, []);
    await h.render(createElement(Probe, { revision: "" })); await request(); await response([file], { workspaceRevision: "anything" }); assert.deepEqual(current.completions, [file]);
  });
  test("unmount cancels scheduled requests", async () => {
    await h.render(createElement(Probe)); await request("./s", 3, false); await h.render(createElement("div")); await settle(165); assert.equal(posts.length, 0);
  });
});

import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import type { ChatMessage } from "@webview/views/chatView/ChatViewTypes";
import { useStreamHandler } from "@webview/views/chatView/hooks/UseStreamHandler";

suite("streaming React hook characterization", () => {
  let dom: JSDOM;
  let root: Root;
  let hook: ReturnType<typeof useStreamHandler>;
  let messages: ChatMessage[];
  let setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  let frames: Map<number, FrameRequestCallback>;
  let original: Map<string, PropertyDescriptor | undefined>;

  setup(async () => {
    original = new Map(); frames = new Map(); let nextFrame = 0;
    dom = new JSDOM("<!doctype html><div id='root'></div>");
    const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame: (id: number) => { frames.delete(id); } };
    for (const [key, value] of Object.entries(globals)) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    }
    const { createRoot } = await import("react-dom/client");
    root = createRoot(dom.window.document.getElementById("root")!);
    function Probe() {
      [messages, setMessages] = useState<ChatMessage[]>([]);
      hook = useStreamHandler();
      return null;
    }
    await act(async () => { root.render(createElement(Probe)); });
  });

  teardown(async () => {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) { Object.defineProperty(globalThis, key, descriptor); }
      else { Reflect.deleteProperty(globalThis, key); }
    }
  });

  async function delta(id: string, type: "content" | "reasoning", content: string, generation = "turn-1") {
    await act(async () => { hook.appendTimelineDelta(id, type, content, setMessages, generation); });
  }
  async function flush() { await act(async () => { hook.flushTimelineDeltas(); }); }

  test("batches chunks into one assistant message and joins text in arrival order", async () => {
    await delta("answer", "content", "Hello"); await delta("answer", "content", " world");
    assert.equal(messages.length, 0);
    assert.equal(frames.size, 1);
    await flush();
    assert.deepEqual(messages, [{ id: "active-turn-1", role: "assistant", generationId: "turn-1", content: "Hello world",
      timeline: [{ id: "answer", type: "content", content: "Hello world" }] }]);
    assert.equal(frames.size, 0);
    await flush();
    assert.equal(messages.length, 1);
  });

  test("the animation frame flushes pending text", async () => {
    await delta("answer", "content", "frame result");
    await act(async () => { [...frames.values()][0]!(0); });
    assert.equal(messages[0]!.content, "frame result");
    assert.equal(frames.size, 0);
  });

  test("a timer flushes pending text when animation frames are suspended", async () => {
    await delta("answer", "content", "background result");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 70)); });
    assert.equal(messages[0]!.content, "background result");
    assert.equal(frames.size, 0);
  });

  test("empty deltas do not schedule updates or create messages", async () => {
    await delta("answer", "content", ""); await flush();
    assert.deepEqual(messages, []); assert.equal(frames.size, 0);
  });

  test("keeps reasoning separate from the visible answer", async () => {
    await delta("reason", "reasoning", "Thinking"); await delta("reason", "reasoning", " carefully");
    await delta("answer", "content", "Result"); await flush();
    assert.equal(messages[0]!.content, "Result");
    assert.deepEqual(messages[0]!.timeline, [{ id: "reason", type: "reasoning", content: "Thinking carefully" },
      { id: "answer", type: "content", content: "Result" }]);
  });

  test("flushes queued text before adding a tool group and does not duplicate that group", async () => {
    await delta("answer", "content", "Before tools");
    const group = { id: "tools", type: "tool-group" as const, round: 1, toolCallIds: ["call-1"] };
    await act(async () => { hook.appendTimelineToolGroup(group, setMessages, "turn-1"); });
    await act(async () => { hook.appendTimelineToolGroup(group, setMessages, "turn-1"); });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.content, "Before tools");
    assert.deepEqual(messages[0]!.timeline?.map((e) => e.id), ["answer", "tools"]);
  });

  test("flushes immediately at the pending text limit", async () => {
    await delta("answer", "content", "x".repeat(32 * 1024));
    assert.equal(messages[0]!.content.length, 32 * 1024);
    assert.equal(frames.size, 0);
  });

  test("bounds accumulated reasoning while preserving the beginning and end", async () => {
    await delta("reason", "reasoning", "start" + "x".repeat(300 * 1024));
    await delta("reason", "reasoning", "y".repeat(300 * 1024) + "end");
    const reasoning = messages[0]!.timeline![0]!;
    assert.equal(reasoning.type, "reasoning");
    if (reasoning.type !== "reasoning") { throw new Error("Missing reasoning"); }
    assert.ok(reasoning.content.length <= 512 * 1024);
    assert.ok(reasoning.content.startsWith("start")); assert.ok(reasoning.content.endsWith("end"));
    assert.match(reasoning.content, /older reasoning omitted/);
    assert.equal(messages[0]!.content, "");
  });

  test("reset starts a separate assistant message for the next generation", async () => {
    await delta("first", "content", "First"); await flush();
    await act(async () => { hook.resetStreaming(); });
    await delta("second", "content", "Second", "turn-2"); await flush();
    assert.deepEqual(messages.map((m) => [m.id, m.content]), [["active-turn-1", "First"], ["active-turn-2", "Second"]]);
  });

  test("reuses an existing active message after a restored snapshot", async () => {
    await act(async () => { setMessages([{ id: "active-turn-1", role: "assistant", content: "Restored", generationId: "turn-1" }]); });
    await delta("answer", "content", " continued"); await flush();
    assert.equal(messages.length, 1); assert.equal(messages[0]!.content, "Restored continued");
  });

  test("creates a stable generated identity when no generation ID is supplied", async () => {
    await act(async () => { hook.appendTimelineDelta("answer", "content", "anonymous", setMessages); });
    await flush();
    assert.match(messages[0]!.id, /^[0-9a-f-]{36}$/);
    assert.equal(messages[0]!.content, "anonymous");
    assert.equal(messages[0]!.generationId, undefined);
  });

  test("a tool-first turn appends to a restored message and preserves unrelated messages", async () => {
    const previous: ChatMessage = { id: "user", role: "user", content: "Question" };
    await act(async () => { setMessages([previous, { id: "active-turn-1", role: "assistant", content: "" }]); });
    const group = { id: "tools-first", type: "tool-group" as const, round: 1, toolCallIds: ["call-1"] };
    await act(async () => { hook.appendTimelineToolGroup(group, setMessages, "turn-1"); });
    assert.equal(messages.length, 2);
    assert.equal(messages[0], previous);
    assert.deepEqual(messages[1]!.timeline, [group]);
  });

  test("unmount cancels pending frames and discards pending UI updates", async () => {
    await delta("answer", "content", "pending");
    const instance = hook;
    await act(async () => { root.unmount(); });
    assert.equal(frames.size, 0);
    assert.equal(instance.streamingMessageIdRef.current, null);
    assert.deepEqual(messages, []);
    // The common teardown can safely unmount an already unmounted root.
  });
});

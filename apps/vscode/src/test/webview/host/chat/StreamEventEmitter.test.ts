import * as assert from "assert";
import { StreamEventEmitter } from "@/vscode/webviews/handlers/chat/streaming/StreamEventEmitter";

suite("StreamEventEmitter", () => {
  test("bounds retained reasoning while delivering full deltas and retaining final content", () => {
    const posted: Array<Record<string, unknown>> = [];
    const emitter = new StreamEventEmitter({ publish: message => { posted.push(message); } });
    const reasoning = "a".repeat(512 * 1024);
    emitter.reasoning(reasoning); emitter.reasoning("extra"); emitter.chunk("Answer");
    const timeline = emitter.getTimeline();
    assert.strictEqual(timeline[0].type, "reasoning");
    if (timeline[0].type === "reasoning") {
      assert.ok(Buffer.byteLength(timeline[0].content) <= 512 * 1024);
    }
    assert.strictEqual(posted[0].content, reasoning);
    assert.strictEqual(posted[1].content, "extra");
    assert.strictEqual(timeline[1].type === "content" && timeline[1].content, "Answer");
  });

  test("dispatches provider chunks, ignores empty deltas and keeps timeline snapshots independent", () => {
    const posted: Array<Record<string, unknown>> = [];
    const emitter = new StreamEventEmitter({ publish: message => { posted.push(message); } });
    emitter.showTyping();
    emitter.fromChunk({ type: "content" });
    emitter.fromChunk({ type: "reasoning" });
    emitter.fromChunk({ type: "tool_call" });
    emitter.fromChunk({ type: "usage" });
    assert.deepStrictEqual(posted, [{ type: "showTyping" }]);
    emitter.fromChunk({ type: "content", content: "Hello" });
    emitter.fromChunk({ type: "content", content: " world" });
    emitter.fromChunk({ type: "reasoning", reasoning_content: "Thought" });
    const ids = ["call"];
    emitter.toolGroup(2, ids); ids.push("external");
    const snapshot = emitter.getTimeline();
    if (snapshot[0].type === "content") { snapshot[0].content = "mutated"; }
    if (snapshot[2].type === "tool-group") { snapshot[2].toolCallIds.push("mutated"); }
    const fresh = emitter.getTimeline();
    assert.strictEqual(fresh[0].type === "content" && fresh[0].content, "Hello world");
    assert.deepStrictEqual(fresh[2].type === "tool-group" && fresh[2].toolCallIds, ["call"]);
    emitter.fromChunk({ type: "done", finish_reason: "stop" });
    emitter.fromChunk({ type: "error" });
    emitter.fromChunk({ type: "error", error: "Failure" });
    emitter.done();
    assert.deepStrictEqual(posted.slice(-4), [
      { type: "streamDone", finish_reason: "stop" },
      { type: "streamError", error: "Unknown stream error" },
      { type: "streamError", error: "Failure" },
      { type: "streamDone" },
    ]);
  });

  test("creates ordered native events across reasoning, tools and content", () => {
    const posted: unknown[] = [];
    const emitter = new StreamEventEmitter({
      publish: (message: unknown) => {
        posted.push(message);
        return Promise.resolve();
      },
    });

    emitter.reasoning("First ");
    emitter.reasoning("thought");
    emitter.toolGroup(1, ["call-1"]);
    emitter.reasoning("Second thought");
    emitter.chunk("Final answer");

    const timeline = emitter.getTimeline();
    assert.deepStrictEqual(
      timeline.map((event) => event.type),
      ["reasoning", "tool-group", "reasoning", "content"],
    );
    assert.strictEqual(timeline[0].type === "reasoning" && timeline[0].content, "First thought");
    assert.strictEqual(timeline[1].type === "tool-group" && timeline[1].round, 1);
    assert.strictEqual(timeline[2].type === "reasoning" && timeline[2].content, "Second thought");
    assert.strictEqual(timeline[3].type === "content" && timeline[3].content, "Final answer");
    assert.deepStrictEqual(
      posted.map((message) => (message as { type: string }).type),
      [
        "streamTimelineDelta",
        "streamTimelineDelta",
        "streamTimelineToolGroup",
        "streamTimelineDelta",
        "streamTimelineDelta",
      ],
    );
  });

  test("preserves the typed steering reason on the terminal event", () => {
    const posted: unknown[] = [];
    const emitter = new StreamEventEmitter({
      publish: (message: unknown) => {
        posted.push(message);
        return Promise.resolve();
      },
    });

    emitter.done({ status: "interrupted", generationStopReason: "steered" });

    assert.deepStrictEqual(posted, [{
      type: "streamDone",
      status: "interrupted",
      generationStopReason: "steered",
    }]);
  });
});

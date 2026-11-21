import * as assert from "assert";
import { readSSEStream } from "@/infrastructure/deepseek/streaming/ReadSSEStream";

suite("SSE reader", () => {
  test("supports split chunks, comments, data without spaces and multiline events", async () => {
    const encoder = new TextEncoder();
    const values: unknown[] = [];
    let doneCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": keepalive\r\ndata:{\"value\":"));
        controller.enqueue(encoder.encode("\r\ndata:42}\r\n\r\ndata: [DONE]\r\n\r\n"));
        controller.close();
      },
    });
    await readSSEStream({ reader: stream.getReader(), onChunk: (value) => values.push(value), onDone: () => doneCount++ });
    assert.deepStrictEqual(values, [{ value: 42 }]);
    assert.strictEqual(doneCount, 1);
  });

  test("reports malformed JSON instead of silently dropping it", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {bad}\n\n")); controller.close(); } });
    await assert.rejects(readSSEStream({ reader: stream.getReader(), onChunk: () => undefined, onDone: () => undefined }), /Malformed SSE JSON/);
  });

  test("rejects EOF without the terminal marker", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {\"value\":1}\n\n")); controller.close(); } });
    await assert.rejects(readSSEStream({ reader: stream.getReader(), onChunk: () => undefined, onDone: () => undefined }), /before the \[DONE\] marker/);
  });

  test("bounds an unterminated event buffer", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${"x".repeat(65)}`)); controller.close(); } });
    await assert.rejects(
      readSSEStream({ reader: stream.getReader(), onChunk: () => undefined, onDone: () => undefined, maxBufferBytes: 64 }),
      /SSE buffer exceeded 64 bytes/,
    );
  });

  test("times out an inactive stream and cancels its reader", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() {cancelled = true;} });
    await assert.rejects(
      readSSEStream({ reader: stream.getReader(), onChunk: () => undefined, onDone: () => undefined, inactivityTimeoutMs: 20 }),
      /inactive for 20 ms/,
    );
    assert.strictEqual(cancelled, true);
  });
});

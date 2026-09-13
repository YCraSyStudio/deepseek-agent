import * as assert from "node:assert";
import { createDeepSeekToolCallModelClient } from "@/infrastructure/deepseek/provider/features/toolCall/DeepSeekToolCallModelClient";

suite("native tool-call streaming", () => {
  test("emits short assistant chunks immediately without a protocol tail buffer", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse([
      { choices: [{ delta: { content: "first" }, finish_reason: null }] },
      { choices: [{ delta: { content: " second" }, finish_reason: "stop" }] },
    ])) as typeof fetch;

    try {
      const streamed: string[] = [];
      const client = createDeepSeekToolCallModelClient("test-key", "https://api.deepseek.com");
      const response = await client.streamRound({
        messages: [{ role: "user", content: "answer" }],
        tools: [{
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          },
        }],
        model: "deepseek-flash",
        cycleOptions: { onStreamChunk: (content) => streamed.push(content) },
      });

      assert.deepStrictEqual(streamed, ["first", " second"]);
      assert.strictEqual(response.choices[0].message.content, "first second");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function sseResponse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

import * as assert from "node:assert";
import { createDeepSeekToolCallModelClient } from "@/infrastructure/deepseek/provider/features/toolCall/DeepSeekToolCallModelClient";
import { streamToolCallRound } from "@/infrastructure/deepseek/provider/features/toolCall/ToolCallStreaming";
import type { ToolCallCycleOptions } from "@/application/chat/toolCall/ToolCallTypes";

suite("native tool-call streaming", () => {
  test("orders interleaved calls and accepts late identifiers and function names", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "temporary", function: { name: "temporary", arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "first" }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "second", function: { name: "read_file", arguments: '"a.txt"}' } }, { index: 0, function: { name: "read_file", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
    ]);
    try {
      const response = await streamToolCallRound({ messages: [], tools: [tool], model: "deepseek-flash", apiKey: "fixture", baseUrl: "https://api.deepseek.com", cycleOptions: {} });
      assert.deepStrictEqual(response.choices[0].message.tool_calls?.map(call => [call.id, call.function.name, call.function.arguments]), [["first", "read_file", "{}"], ["second", "read_file", '{"path":"a.txt"}']]);
    } finally { globalThis.fetch = originalFetch; }
  });
  test("accumulates suppressed deltas and usage while honoring a disabled live strict setting", async () => {
    const originalFetch = globalThis.fetch; const emitted: string[] = []; let usage: unknown; let endpoint = "";
    globalThis.fetch = async (url) => { endpoint = String(url); return sseResponse([
      { choices: [{ delta: { content: "", reasoning_content: "" } }] },
      { choices: [{ delta: { content: "Answer", reasoning_content: "Reason" } }] },
      { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
    ]); };
    try {
      const response = await streamToolCallRound({ messages: [], tools: [tool], model: "deepseek-flash", apiKey: "fixture", baseUrl: "https://api.deepseek.com", emitStreamEvents: false,
        cycleOptions: { strictToolCallsEnabled: true, isStrictToolCallsEnabled: () => false, onStreamChunk: value => { emitted.push(value); }, onStreamReasoning: value => { emitted.push(value); }, onUsage: value => { usage = value; } } });
      assert.deepStrictEqual(emitted, []); assert.strictEqual(response.choices[0].message.content, "Answer");
      assert.strictEqual(response.choices[0].message.reasoning_content, "Reason");
      assert.strictEqual(response.choices[0].finish_reason, "stop");
      assert.deepStrictEqual(usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
      assert.deepStrictEqual(response.usage, usage); assert.ok(!endpoint.includes("/beta/"));
    } finally { globalThis.fetch = originalFetch; }
  });
  test("rejects tool arguments that exceed the byte limit across individually bounded SSE events", async () => {
    const originalFetch = globalThis.fetch;
    const events = [0, 1, 2].map(index => ({ choices: [{ delta: { tool_calls: [{ index: 0, ...(index === 0 ? { id: "call" } : {}), function: { ...(index === 0 ? { name: "read_file" } : {}), arguments: "x".repeat(800000) } }] } }] }));
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      for (const event of events) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
    try {
      await assert.rejects(streamToolCallRound({ messages: [], tools: [tool], model: "deepseek-flash", apiKey: "fixture", baseUrl: "https://api.deepseek.com", cycleOptions: {} }), error =>
        error instanceof Error && error.cause instanceof Error && /tool arguments exceeded their size limit/.test(error.cause.message));
    } finally { globalThis.fetch = originalFetch; }
  });
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

  const tool = {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  };

  test("merges streamed tool-call deltas into ordered assistant tool calls", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":" } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"a.txt\"}" } }, { index: 1, id: "call_2", type: "function", function: { name: "search_content", arguments: "{}" } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ])) as typeof fetch;
    try {
      const response = await streamToolCallRound({
        messages: [{ role: "system", content: "System" }, { role: "user", content: "read" }],
        tools: [tool],
        model: "deepseek-flash",
        apiKey: "fixture-key",
        baseUrl: "https://api.deepseek.com",
        cycleOptions: { strictToolCallsEnabled: true },
      });
      const message = response.choices[0].message;
      assert.deepStrictEqual(
        message.tool_calls?.map((toolCall) => [toolCall.id, toolCall.function.name, toolCall.function.arguments]),
        [["call_1", "read_file", "{\"path\":\"a.txt\"}"], ["call_2", "search_content", "{}"]],
      );
      assert.strictEqual(message.content, null);
      assert.strictEqual(response.choices[0].finish_reason, "tool_calls");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("surfaces a missing stream body as a stream error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    try {
      await assert.rejects(streamToolCallRound({
        messages: [{ role: "user", content: "read" }],
        tools: [tool],
        model: "deepseek-flash",
        apiKey: "fixture-key",
        baseUrl: "https://api.deepseek.com",
        cycleOptions: {},
      }), /Stream not available/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retries once with a concise instruction when reasoning exceeds its budget", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    let attempts = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      attempts += 1;
      if (attempts === 1) {
        return sseResponse([{ choices: [{ delta: { reasoning_content: "very long reasoning" }, finish_reason: null }] }], false);
      }
      return sseResponse([{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }]);
    }) as typeof fetch;
    const events: string[] = [];
    const budgetManager = {
      observeOutput: () => ({ status: "output_reasoning_limit" }),
      canRecoverConcise: () => true,
      recordConciseRecovery: () => { events.push("recorded"); },
      recordPromptUsage: () => undefined,
      recordRequestContext: () => undefined,
    } as unknown as ToolCallCycleOptions["budgetManager"];
    try {
      const response = await streamToolCallRound({
        messages: [{ role: "system", content: "System" }, { role: "user", content: "answer" }],
        tools: [tool],
        model: "deepseek-flash",
        apiKey: "fixture-key",
        baseUrl: "https://api.deepseek.com",
        cycleOptions: { budgetManager, onRecoveryStarted: async () => { events.push("notified"); } },
      });
      assert.strictEqual(attempts, 2);
      assert.deepStrictEqual(events, ["recorded", "notified"]);
      assert.match(String((bodies[1].messages as Array<{ content?: string }>)[0].content), /<concise_recovery>/);
      assert.deepStrictEqual(bodies[1].thinking, { type: "disabled" });
      assert.strictEqual(response.choices[0].message.content, "done");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function sseResponse(events: unknown[], done = true): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}${done ? "data: [DONE]\n\n" : ""}`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

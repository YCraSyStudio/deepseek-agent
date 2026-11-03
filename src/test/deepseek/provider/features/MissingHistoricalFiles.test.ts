import { createDeepSeekToolCallModelClient } from "@/infrastructure/deepseek/provider/features/toolCall/DeepSeekToolCallModelClient";
import { runToolCallCycle } from "@/application/chat/toolCall/ToolCallCycle";
import assert from "node:assert/strict";
import type { ChatCompletionRequest } from "@/contracts";
import { DEFAULT_CONFIG } from "@/contracts";
import { HistoricalFileRecovery, recoverMissingHistoricalFiles } from "@/infrastructure/deepseek/provider/features/MissingHistoricalFiles";
import { DeepSeekApiError } from "@/infrastructure/deepseek/errors/DeepSeekApiError";
import { DeepSeekModelProvider } from "@/infrastructure/deepseek/provider/DeepSeekProvider";

const missing = new DeepSeekApiError(400, "API request failed with HTTP 400. messages: the following file_ids do not exist or are not created under your account: file-api-missing (request_id: abc)");
function request(): ChatCompletionRequest {
  return { model: "deepseek-flash", messages: [
    { role: "user", content: [{ type: "text", text: "old question" }, { type: "file", file_id: "file-api-missing" }, { type: "file", file_id: "file-api-valid" }] },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "fix the input" },
  ] };
}
suite("missing historical image recovery", () => {
  test("replaces only explicitly rejected historical files and preserves the input", () => {
    const original = request();
    const recovered = recoverMissingHistoricalFiles(original, missing)!;
    assert.ok(recovered);
    assert.match(JSON.stringify(recovered.messages[0]), /visual contents are unavailable/);
    assert.ok(JSON.stringify(recovered).includes('"file_id":"file-api-valid"'));
    assert.ok(!JSON.stringify(recovered).includes('"file_id":"file-api-missing"'));
    assert.ok(JSON.stringify(original).includes('"file_id":"file-api-missing"'));
    assert.deepEqual(recovered.messages[2], original.messages[2]);
  });
  test("does not silently drop an image from the current turn or retry unrelated errors", () => {
    const current = request();current.messages = [current.messages[0]];
    assert.equal(recoverMissingHistoricalFiles(current, missing), undefined);
    assert.equal(recoverMissingHistoricalFiles(request(), new DeepSeekApiError(400, "invalid tools")), undefined);
    assert.equal(recoverMissingHistoricalFiles(request(), new DeepSeekApiError(500, missing.message)), undefined);
  });
  test("protects the current attachment even when a native screenshot adds a later user message", () => {
    const original = request();
    original.messages[2] = { role: "user", content: [{ type: "text", text: "Look at this new attachment" }, { type: "file", file_id: "file-api-current" }] };
    const recovery = new HistoricalFileRecovery(original.messages);
    const withCapture = { ...original, messages: [...original.messages, { role: "user" as const, content: [{ type: "file" as const, file_id: "file-api-capture" }] }] };
    const currentError = new DeepSeekApiError(400, missing.message.replace("file-api-missing", "file-api-current"));
    assert.equal(recovery.recover(withCapture, currentError), undefined);
    const captureError = new DeepSeekApiError(400, missing.message.replace("file-api-missing", "file-api-capture"));
    assert.equal(recovery.recover(withCapture, captureError), undefined);
    const recovered = recovery.recover(withCapture, missing)!;
    assert.ok(recovered);
    assert.ok(JSON.stringify(recovered).includes('"file_id":"file-api-current"'));
    assert.ok(JSON.stringify(recovered).includes('"file_id":"file-api-capture"'));
    assert.ok(!JSON.stringify(recovery.prepare(withCapture)).includes('"file_id":"file-api-missing"'));
  });

  for (const stream of [false, true]) {
    test(`tool cycles recover historical files once and omit them in later rounds (stream=${stream})`, async () => {
      const originalFetch = globalThis.fetch;
      const bodies: ChatCompletionRequest[] = [];
      const chunks: string[] = [];
      let executed = 0;
      try {
        globalThis.fetch = async (_url, options) => {
          const body = JSON.parse(String(options?.body)) as ChatCompletionRequest;
          bodies.push(body);
          if (bodies.length === 1) {return Response.json({ error: { message: missing.message } }, { status: 400 });}
          const calls = bodies.length === 2 ? [{ id: "read", type: "function", function: { name: "read_file", arguments: '{"path":"README.md"}' } }] : undefined;
          const content = calls ? null : "Continued without inventing the missing image.";
          if (body.stream) {
            return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: calls
              ? { tool_calls: calls.map((call, index) => ({ ...call, index })) } : { content }, finish_reason: calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
          }
          return Response.json({ id: "ok", object: "chat.completion", created: 1, model: "deepseek-flash",
            choices: [{ index: 0, message: { role: "assistant", content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? "tool_calls" : "stop" }] });
        };
        const initial = request();
        const result = await runToolCallCycle({ initialMessages: initial.messages, model: initial.model,
          tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } }],
          modelClient: createDeepSeekToolCallModelClient("test-key", DEFAULT_CONFIG.baseUrl, initial.messages),
          executeToolCall: async () => {executed++; return "Read completed";},
          cycleOptions: { streamFinalResponse: stream, onStreamChunk: content => {chunks.push(content);} },
        });
        assert.equal(bodies.length, 3); assert.equal(executed, 1);
        for (const body of bodies.slice(1)) {
          assert.ok(!JSON.stringify(body).includes('"file_id":"file-api-missing"'));
          assert.ok(JSON.stringify(body).includes('"file_id":"file-api-valid"'));
          assert.match(JSON.stringify(body), /visual contents are unavailable/);
        }
        assert.equal(result.finalMessage.content, "Continued without inventing the missing image.");
        if (stream) {assert.equal(chunks.join(""), result.finalMessage.content);}
        assert.ok(JSON.stringify(initial).includes('"file_id":"file-api-missing"'), "Recovery must not rewrite saved attachment references");
      } finally {globalThis.fetch = originalFetch;}
    });
  }

  test("retries a rejected historical reference once through the provider", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: ChatCompletionRequest[] = [];
    try {
      globalThis.fetch = async (_url, options) => {
        bodies.push(JSON.parse(String(options?.body)) as ChatCompletionRequest);
        if (bodies.length === 1) {return Response.json({ error: { message: missing.message } }, { status: 400 });}
        return Response.json({ id: "ok", object: "chat.completion", created: 1, model: "deepseek-flash", choices: [{ index: 0, message: { role: "assistant", content: "fixed" }, finish_reason: "stop" }] });
      };
      const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "test-key" });
      await provider.chatCompletion(request());
      assert.equal(bodies.length, 2);
      assert.ok(!JSON.stringify(bodies[1]).includes('"file_id":"file-api-missing"'));
      bodies.length = 0;
      globalThis.fetch = async () => {bodies.push(request());return Response.json({ error: { message: missing.message } }, { status: 400 });};
      await assert.rejects(provider.chatCompletion(request()), /HTTP 400/);
      assert.equal(bodies.length, 2);
    } finally {globalThis.fetch = originalFetch;}
  });
  test("stream recovery emits a single response", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) {return Response.json({ error: { message: missing.message } }, { status: 400 });}
        return new Response('data: {"choices":[{"delta":{"content":"fixed"},"finish_reason":null}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      };
      const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "test-key" });
      const chunks: unknown[] = [];
      await provider.chatCompletionStream(request(), chunk => chunks.push(chunk));
      assert.equal(calls, 2);
      assert.equal(chunks.filter(chunk => (chunk as { type: string }).type === "done").length, 1);
    } finally {globalThis.fetch = originalFetch;}
  });
});

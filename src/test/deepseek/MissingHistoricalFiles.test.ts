import assert from "node:assert/strict";
import type { ChatCompletionRequest } from "@/contracts";
import { DEFAULT_CONFIG } from "@/contracts";
import { recoverMissingHistoricalFiles } from "@/infrastructure/deepseek/provider/features/MissingHistoricalFiles";
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

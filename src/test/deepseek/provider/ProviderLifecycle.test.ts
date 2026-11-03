import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "@/contracts/Config";
import { DeepSeekModelProvider } from "@/infrastructure/deepseek/provider/DeepSeekProvider";
import { DeepSeekModelProviderFactory } from "@/infrastructure/deepseek/provider/DeepSeekModelProviderFactory";

suite("DeepSeek provider lifecycle", () => {
  let original: typeof fetch;
  setup(() => { original = globalThis.fetch; });
  teardown(() => { globalThis.fetch = original; });
  test("creates independent providers and applies partial configuration updates to subsequent model discovery", async () => {
    const factory = new DeepSeekModelProviderFactory();
    const first = factory.create({ ...DEFAULT_CONFIG, apiKey: "old-key" });
    const second = factory.create({ ...DEFAULT_CONFIG, apiKey: "separate-key" });
    assert.ok(first instanceof DeepSeekModelProvider); assert.notEqual(first, second);
    first.updateConfig({ apiKey: "new-key", baseUrl: "https://provider.example.test/api" });
    const requests: Array<{ url: string; key: string | null }> = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), key: new Headers(init?.headers).get("Authorization") });
      return Response.json({ data: [{ id: "available-model" }] });
    };
    assert.deepEqual(await first.listModels(), [{ id: "available-model", name: "available-model" }]);
    assert.deepEqual(await second.listModels(), [{ id: "available-model", name: "available-model" }]);
    assert.deepEqual(requests, [
      { url: "https://provider.example.test/api/models", key: "Bearer new-key" },
      { url: "https://api.deepseek.com/models", key: "Bearer separate-key" },
    ]);
  });
  test("uses the configured model for omitted request models in completion and streaming", async () => {
    const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "fixture-key", model: "custom-model", baseUrl: "https://provider.example.test" });
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      return body.stream ? new Response('data: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
        : Response.json({ id: "response", object: "chat.completion", created: 1, model: "custom-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
    };
    await provider.chatCompletion({ model: "", messages: [{ role: "user", content: "Hello" }] });
    await provider.chatCompletionStream({ model: "", messages: [{ role: "user", content: "Hello" }] }, () => undefined);
    assert.equal(requests.length, 2); assert.ok(requests.every(request => request.model === "custom-model"));
  });
  test("reports successful connection checks and non-Error transport failures", async () => {
    const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "fixture-key", thinkingMode: false });
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 2); assert.equal(body.thinking.type, "disabled");
      return Response.json({ id: "response", object: "chat.completion", created: 1, model: "custom-model", choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }] });
    };
    const connection = await provider.testConnection();
    assert.equal(connection.success, true, connection.error);
    assert.deepEqual(connection, { success: true });
    globalThis.fetch = async () => { throw "transport disconnected"; };
    assert.deepEqual(await provider.testConnection(), { success: false, error: "transport disconnected" });
  });
});

import * as assert from "assert";
import type { ToolDefinition } from "@/contracts";
import { DEFAULT_CONFIG } from "@/contracts/Config";
import { DeepSeekModelProvider, assertCompatibleModel } from "@/infrastructure/deepseek/provider/DeepSeekProvider";
import { buildChatBody } from "@/infrastructure/deepseek/provider/features/Chat";
import { buildToolCallRequest } from "@/infrastructure/deepseek/provider/features/toolCall/ToolCallRequest";

suite("DeepSeek provider contract", () => {
  const tool: ToolDefinition = {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      strict: true,
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  };

  test("keeps tools in thinking and non-thinking requests", () => {
    const thinking = buildChatBody({ tools: [tool] }, { ...DEFAULT_CONFIG, thinkingMode: true });
    const nonThinking = buildChatBody({ tools: [tool] }, { ...DEFAULT_CONFIG, thinkingMode: false });

    assert.strictEqual(thinking.tools?.length, 1);
    assert.strictEqual(nonThinking.tools?.length, 1);
    assert.strictEqual(thinking.thinking?.type, "enabled");
    assert.strictEqual(nonThinking.thinking?.type, "disabled");
  });

  test("keeps non-thinking mode disabled throughout tool-call rounds", () => {
    const request = buildToolCallRequest({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "Read the file" }],
      tools: [tool],
      stream: true,
      cycleOptions: { thinkingMode: false },
    });

    assert.strictEqual(request.thinking?.type, "disabled");
    assert.strictEqual(request.reasoning_effort, undefined);
    assert.strictEqual(request.tools?.length, 1);
  });

  test("does not send beta-only strict fields through the stable endpoint", () => {
    const body = buildChatBody({ tools: [tool] }, DEFAULT_CONFIG);
    assert.strictEqual(body.tools?.[0].function.strict, undefined);
    assert.strictEqual(JSON.stringify(body).includes('"strict"'), false);
  });

  test("restricts official DeepSeek model IDs but permits compatible custom providers", () => {
    assert.doesNotThrow(() => assertCompatibleModel("deepseek-flash", "https://api.deepseek.com"));
    assert.throws(() => assertCompatibleModel("deepseek-v4-flash-vision-exp", "https://api.deepseek.com"), /not supported/);
    assert.throws(() => assertCompatibleModel("deepseek-v4-flash", "https://api.deepseek.com"), /not supported/);
    assert.doesNotThrow(() => assertCompatibleModel("deepseek-v4-pro", "https://api.deepseek.com"));
    assert.throws(() => assertCompatibleModel("custom-model", "https://api.deepseek.com"), /not supported/);
    assert.doesNotThrow(() => assertCompatibleModel("custom-model", "http://127.0.0.1:11434/v1"));
  });

  test("connection checks use the same official-model compatibility policy", async () => {
    const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "unused", model: "custom-model", baseUrl: "https://api.deepseek.com" });
    assert.deepStrictEqual(await provider.testConnection(), {
      success: false,
      error: 'Model "custom-model" is not supported by the official DeepSeek API configuration.',
    });
  });

  test("sends image file references to the model without a hidden fallback request", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    try {
      globalThis.fetch = async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({
          id: "vision-response",
          object: "chat.completion",
          created: 1,
          model: "deepseek-flash",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      };
      const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "test-key" });
      await provider.chatCompletion({
        model: "deepseek-flash",
        messages: [{ role: "user", content: [{ type: "text", text: "describe" }, { type: "file", file_id: "file-test123" }] }],
      });

      assert.deepStrictEqual(bodies.map((body) => body.model), ["deepseek-flash"]);
      assert.match(JSON.stringify(bodies[0]), /file-test123/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not retry or rewrite requests for provider failures", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = async () => {
        calls += 1;
        return Response.json({ error: { message: "model removed" } }, { status: 410 });
      };
      const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "test-key" });
      await assert.rejects(provider.chatCompletion({
        model: "deepseek-flash",
        messages: [{ role: "user", content: [{ type: "text", text: "describe" }, { type: "file", file_id: "file-test123" }] }],
      }));
      assert.strictEqual(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not retry authentication failures", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = async () => {
        calls += 1;
        return Response.json({ error: { code: "invalid_api_key" } }, { status: 401 });
      };
      const provider = new DeepSeekModelProvider({ ...DEFAULT_CONFIG, apiKey: "bad-key" });
      await assert.rejects(provider.chatCompletion({
        model: "deepseek-flash",
        messages: [{ role: "user", content: "hello" }],
      }), /Invalid API credentials/);
      assert.strictEqual(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps custom endpoints free of official model rewriting", async () => {
    const originalFetch = globalThis.fetch;
    const models: string[] = [];
    try {
      globalThis.fetch = async (_input, init) => {
        models.push((JSON.parse(String(init?.body)) as { model: string }).model);
        return Response.json({ error: { code: "model_not_found", param: "model", message: "Model is not available" } }, { status: 400 });
      };
      const provider = new DeepSeekModelProvider({
        ...DEFAULT_CONFIG,
        apiKey: "test-key",
        baseUrl: "http://127.0.0.1:11434/v1",
      });
      await assert.rejects(provider.chatCompletion({
        model: "llama-3.1-8b",
        messages: [{ role: "user", content: "hello" }],
      }));
      assert.deepStrictEqual(models, ["llama-3.1-8b"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

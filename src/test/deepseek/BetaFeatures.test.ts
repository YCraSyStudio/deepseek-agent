import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type ToolDefinition } from "@/contracts";
import { resolveDeepSeekApiBaseUrl } from "@/infrastructure/deepseek/client/BetaFeatures";
import { createBetaCodeCompleter } from "@/infrastructure/deepseek/provider/features/CodeCompletion";
import { chatCompletion } from "@/infrastructure/deepseek/provider/features/Chat";
import { DeepSeekModelProvider } from "@/infrastructure/deepseek/provider/DeepSeekProvider";
import { prepareProviderTools, normalizeBetaToolMessages } from "@/infrastructure/deepseek/provider/features/StrictTools";
import { createDeepSeekToolCallModelClient } from "@/infrastructure/deepseek/provider/features/toolCall/DeepSeekToolCallModelClient";
import { BUILT_IN_TOOLS } from "@/infrastructure/tools/builtins";
import { createHeadlessWebTools } from "@/infrastructure/browser/BrowserTools";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { completeCodeTool } from "@/infrastructure/tools/builtins/code/CompleteCode";
import { isRecord } from "@/shared/utils/TypeGuards";

const config = { ...DEFAULT_CONFIG, betaFeaturesEnabled: true, apiKey: "test-key", thinkingMode: false };
const tool: ToolDefinition = { type: "function", function: { name: "read_file", strict: true,
  parameters: { type: "object", properties: { path: { type: "string", maxLength: 40 }, limit: { type: "integer", minimum: 1 } },
    required: ["path"], additionalProperties: false },
} };

suite("DeepSeek beta features", () => {
  const originalFetch = globalThis.fetch;
  teardown(() => {globalThis.fetch = originalFetch;});

  test("switches endpoints without changing the API origin or proxy prefix", () => {
    for (const suffix of ["", "/v1", "/beta/"]) {
      assert.equal(resolveDeepSeekApiBaseUrl(`https://api.deepseek.com${suffix}`, true), "https://api.deepseek.com/beta");
    }
    assert.equal(resolveDeepSeekApiBaseUrl("https://proxy.example.com/deepseek/v1", true), "https://proxy.example.com/deepseek/beta");
    assert.equal(resolveDeepSeekApiBaseUrl("https://proxy.example.com/deepseek/beta", false), "https://proxy.example.com/deepseek/v1");
  });

  test("uses FIM's prompt/suffix payload and records usage", async () => {
    let counted = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.deepseek.com/beta/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: config.model, prompt: "function sum(a, b) {", suffix: "}", max_tokens: 128, stream: false, stop: ["END"],
      });
      return Response.json({ choices: [{ text: "return a + b;", finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    };
    const complete = createBetaCodeCompleter(config, () => true, (usage) => {counted++; assert.equal(usage?.total_tokens, 15);});
    const result = JSON.parse(await complete({ mode: "fim", prefix: "function sum(a, b) {", suffix: "}", maxTokens: 128, stop: ["END"] }));
    assert.equal(result.content, "return a + b;"); assert.equal(counted, 1);
  });

  test("supports assistant and caller-supplied reasoning prefixes", async () => {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.deepseek.com/beta/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.messages[1], { role: "assistant", content: "```typescript\n", prefix: true, reasoning_content: "Use the supplied grammar." });
      assert.equal(body.thinking.type, "enabled");
      return chatResponse("const parse = () => 1;");
    };
    const complete = createBetaCodeCompleter({ ...config, thinkingMode: true }, () => true, () => {});
    assert.equal(JSON.parse(await complete({ mode: "prefix", prefix: "```typescript\n", instruction: "Complete the parser", reasoningPrefix: "Use the supplied grammar." })).content, "const parse = () => 1;");
  });

  test("blocks disabled, cancelled and invalid beta calls before network access", async () => {
    let calls = 0;
    globalThis.fetch = async () => {calls++; throw new Error("unexpected network");};
    const request = { mode: "fim" as const, prefix: "const value = " };
    await assert.rejects(createBetaCodeCompleter({ ...config, betaFeaturesEnabled: false }, () => true, () => {})(request), /disabled/);
    await assert.rejects(createBetaCodeCompleter(config, () => false, () => {})(request), /disabled/);
    await assert.rejects(createBetaCodeCompleter(config, () => true, () => {})({ ...request, maxTokens: 4097 }), /4096/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(createBetaCodeCompleter(config, () => true, () => {})(request, controller.signal), /abort/i);
    await assert.rejects(chatCompletion({ model: config.model, messages: [{ role: "assistant", content: "prefix", prefix: true }] }, config.apiKey, config.baseUrl), /disabled/);
    await assert.rejects(chatCompletion({ model: config.model, messages: [{ role: "user", content: "prefix", prefix: true }] }, config.apiKey, config.baseUrl, undefined, true), /assistant/);
    assert.equal(calls, 0);
  });

  test("honors the configured output limit and does not expose malformed response bodies", async () => {
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 16);
      return Response.json({ choices: [{ text: "middle", finish_reason: "stop" }] });
    };
    const complete = createBetaCodeCompleter({ ...config, maxTokens: 16 }, () => true, () => {});
    assert.equal(JSON.parse(await complete({ mode: "fim", prefix: "start", maxTokens: 128 })).content, "middle");
    globalThis.fetch = async () => new Response("invalid-json: secret-fixture");
    await assert.rejects(complete({ mode: "fim", prefix: "start" }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "DeepSeek returned invalid FIM JSON.");
      return true;
    });
  });

  test("adapts every registered tool without changing host schemas", () => {
    const web = createHeadlessWebTools({ render: async () => {throw new Error("unused");} }, { systemLocale: () => "en", vscodeLanguage: () => "en" });
    const tools = [...BUILT_IN_TOOLS, ...web].map((item) => item.definition);
    const before = JSON.stringify(tools);
    for (const entry of prepareProviderTools(tools, true)) {assert.equal(entry.function.strict, true); assertStrict(entry.function.parameters);}
    assert.equal(JSON.stringify(tools), before);
    assert.ok(prepareProviderTools(tools, false).every((entry) => entry.function.strict === undefined));
  });

  test("omits optional null arguments but preserves invalid required values for rejection", () => {
    const registry = new ToolRegistry();
    registry.register({ definition: tool, metadata: { dangerLevel: "safe", requiresConfirmation: false }, handler: async () => "ok" });
    for (const path of ["src/main.ts", null]) {
      const message = { role: "assistant" as const, content: null, tool_calls: [{ id: "call", type: "function" as const,
        function: { name: "read_file", arguments: JSON.stringify({ path, limit: null }) } }] };
      const normalized = normalizeBetaToolMessages([message], [tool])[0].tool_calls![0];
      assert.deepEqual(JSON.parse(normalized.function.arguments), { path });
      assert.equal(registry.validate(normalized).valid, path !== null);
    }
  });

  test("obeys the toggle for direct provider calls even with a manually configured beta URL", async () => {
    for (const enabled of [true, false]) {
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), `https://api.deepseek.com/${enabled ? "beta" : "v1"}/chat/completions`);
        assert.equal(JSON.parse(String(init?.body)).tools[0].function.strict, enabled ? true : undefined);
        return chatResponse("ok");
      };
      await new DeepSeekModelProvider({ ...config, betaFeaturesEnabled: enabled, baseUrl: "https://api.deepseek.com/beta" })
        .chatCompletion({ model: config.model, messages: [{ role: "user", content: "read" }], tools: [tool] });
    }
  });

  test("rechecks live settings between streamed tool rounds and normalizes strict arguments", async () => {
    let enabled = true;
    const client = createDeepSeekToolCallModelClient(config.apiKey, config.baseUrl);
    const cycleOptions = { betaFeaturesEnabled: true, isBetaFeaturesEnabled: () => enabled };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), enabled ? "https://api.deepseek.com/beta/chat/completions" : "https://api.deepseek.com/chat/completions");
      assert.equal(JSON.parse(String(init?.body)).tools[0].function.strict, enabled ? true : undefined);
      const chunk = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call", type: "function", function: { name: "read_file", arguments: '{"path":"src/main.ts","limit":null}' } }] }, finish_reason: "tool_calls" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
    const options = { model: config.model, messages: [{ role: "user" as const, content: "read" }], tools: [tool], cycleOptions };
    assert.equal((await client.streamRound(options)).choices[0].message.tool_calls![0].function.arguments, '{"path":"src/main.ts"}');
    enabled = false; await client.streamRound(options);
  });

  test("rejects invalid mode combinations before invoking the completion service", async () => {
    let calls = 0;
    const context = { completeCode: async () => {calls++; return "ok";} };
    await assert.rejects(completeCodeTool.handler({ mode: "fim", prefix: "code", instruction: "chat" }, context), /FIM/);
    await assert.rejects(completeCodeTool.handler({ mode: "prefix", prefix: "code", suffix: "end" }, context), /suffix/);
    assert.equal(calls, 0);
    assert.equal(await completeCodeTool.handler({ mode: "fim", prefix: "code", suffix: "end" }, context), "ok");
  });
});

function chatResponse(content: string): Response {
  return Response.json({ id: "test", object: "chat.completion", created: 1, model: config.model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
}
function assertStrict(value: Record<string, unknown>): void {
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {assert.ok(!Object.hasOwn(value, key));}
  if (isRecord(value.properties)) {
    assert.equal(value.additionalProperties, false); assert.deepEqual(value.required, Object.keys(value.properties));
    for (const property of Object.values(value.properties)) {if (isRecord(property)) {assertStrict(property);}}
  }
  if (isRecord(value.items)) {assertStrict(value.items);}
  if (Array.isArray(value.anyOf)) {for (const item of value.anyOf) {if (isRecord(item)) {assertStrict(item);}}}
}

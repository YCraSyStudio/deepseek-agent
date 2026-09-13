import * as assert from "node:assert";
import type { AppConfig, ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from "@/contracts";
import {
  parseCompletionReview,
  reviewCompletion,
  type ConversationPrefixCache,
} from "@/infrastructure/deepseek/provider/features/CompletionReviewer";
import { createCompletionRecoveryMessage } from "@/application/chat/toolCall/TurnGuidance";

suite("DeepSeek completion reviewer", () => {
  test("accepts only the bounded completion decision schema", () => {
    assert.strictEqual(parseCompletionReview('{"decision":"complete","reason":"The result was delivered."}'), "complete");
    assert.strictEqual(parseCompletionReview('```json\n{"decision":"incomplete","reason":"Another action was announced."}\n```'), "incomplete");
    assert.strictEqual(parseCompletionReview('{"decision":"complete","reason":"ok","extra":true}'), "unknown");
    assert.strictEqual(parseCompletionReview("not json"), "unknown");
  });

  test("replays the answered transcript so its prompt prefix is billed as a cache hit", async () => {
    let captured: ChatCompletionRequest | undefined;
    const transcript: ChatMessage[] = [
      { role: "system", content: "agent" },
      { role: "user", content: "Crea la aplicación" },
      { role: "assistant", content: null, tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "create_file", arguments: '{"path":"src/App.ts"}' },
      }] },
      { role: "tool", name: "create_file", tool_call_id: "call-1", content: "created" },
    ];
    const decision = await reviewCompletion({
      messages: transcript,
      candidate: { role: "assistant", content: "现在我会运行测试。" },
      toolCallsExecuted: 1,
      recoveryAttempted: false,
      providerConfig: config(),
      prefixCache: { reusable: true },
      complete: async (_signal, request) => {
        captured = request;
        return response({ decision: "incomplete", reason: "The candidate announces another required action." });
      },
    });

    assert.strictEqual(decision, "incomplete");
    assert.deepStrictEqual(captured?.thinking, { type: "disabled" });
    assert.strictEqual(captured?.tool_choice, "none");
    assert.strictEqual(captured?.temperature, 0);
    assert.deepStrictEqual(captured?.messages.slice(0, transcript.length), transcript);
    assert.deepStrictEqual(captured?.messages.at(-2), { role: "assistant", content: "现在我会运行测试。" });
    assert.strictEqual(captured?.messages.at(-1)?.role, "user");
    assert.match(String(captured?.messages.at(-1)?.content), /must come from the user/);
    assert.doesNotMatch(String(captured?.messages.at(-1)?.content), /currentUserRequest/);
  });

  test("distills the prompt when the provider does not reuse the prefix", async () => {
    let evidence = "";
    await reviewCompletion({
      messages: [
        { role: "system", content: "agent" },
        { role: "user", content: "Crea la aplicación" },
        { role: "assistant", content: null, tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "create_file", arguments: '{"path":"src/App.ts"}' },
        }] },
        { role: "tool", name: "create_file", tool_call_id: "call-1", content: "created" },
        createCompletionRecoveryMessage(),
      ],
      candidate: { role: "assistant", content: "done" },
      toolCallsExecuted: 1,
      recoveryAttempted: true,
      providerConfig: config(),
      prefixCache: { reusable: false },
      complete: async (_signal, request) => {
        evidence = String(request.messages[1]?.content);
        return response({ decision: "complete", reason: "The result was delivered." });
      },
    });

    assert.match(evidence, /"currentUserRequest":"Crea la aplicación"/);
    assert.doesNotMatch(evidence, /completion_recovery/);
  });

  test("stops replaying the transcript once the provider reports a prompt cache miss", async () => {
    const prefixCache: ConversationPrefixCache = { reusable: true };
    const requests: ChatCompletionRequest[] = [];
    const review = async () => reviewCompletion({
      messages: [
        { role: "system", content: "agent" },
        { role: "user", content: "Construye la aplicación completa ".repeat(400) },
      ],
      candidate: { role: "assistant", content: "done" },
      toolCallsExecuted: 0,
      recoveryAttempted: false,
      providerConfig: config(),
      prefixCache,
      complete: async (_signal, request) => {
        requests.push(request);
        return responseWithCacheHit(requests.length === 1 ? 0 : 3_500);
      },
    });

    await review();
    assert.strictEqual(prefixCache.reusable, false);
    assert.strictEqual(requests[0]?.messages.at(-1)?.role, "user");

    await review();
    assert.strictEqual(requests[1]?.messages[0]?.role, "system");
    assert.match(String(requests[1]?.messages[1]?.content), /"currentUserRequest"/);
  });

  test("keeps replaying the transcript while the provider reports cache hits", async () => {
    const prefixCache: ConversationPrefixCache = { reusable: true };
    await reviewCompletion({
      messages: [
        { role: "system", content: "agent" },
        { role: "user", content: "Construye la aplicación completa ".repeat(400) },
      ],
      candidate: { role: "assistant", content: "done" },
      toolCallsExecuted: 0,
      recoveryAttempted: false,
      providerConfig: config(),
      prefixCache,
      complete: async () => responseWithCacheHit(3_500),
    });

    assert.strictEqual(prefixCache.reusable, true);
  });

  test("falls back to the provider stop signal when the review is invalid", async () => {
    const decision = await reviewCompletion({
      messages: [{ role: "user", content: "answer" }],
      candidate: { role: "assistant", content: "answer" },
      toolCallsExecuted: 0,
      recoveryAttempted: false,
      providerConfig: config(),
      complete: async () => responseText("invalid"),
    });

    assert.strictEqual(decision, "unknown");
  });
});

function config(): AppConfig {
  return {
    model: "deepseek-chat",
    apiKey: "test",
    baseUrl: "https://api.deepseek.com",
  } as AppConfig;
}

function response(value: Record<string, unknown>): ChatCompletionResponse {
  return responseText(JSON.stringify(value));
}

function responseText(content: string): ChatCompletionResponse {
  return {
    id: "review",
    object: "chat.completion",
    created: 0,
    model: "deepseek-chat",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

function responseWithCacheHit(cacheHitTokens: number): ChatCompletionResponse {
  return {
    ...responseText(JSON.stringify({ decision: "complete", reason: "The result was delivered." })),
    usage: {
      prompt_tokens: 4_000,
      completion_tokens: 20,
      total_tokens: 4_020,
      prompt_cache_hit_tokens: cacheHitTokens,
      prompt_cache_miss_tokens: 4_000 - cacheHitTokens,
    },
  };
}

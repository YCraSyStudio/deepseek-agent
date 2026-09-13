import * as assert from "node:assert";
import type { StreamChunk } from "@/contracts";
import { DEFAULT_CONFIG } from "@/contracts/Config";
import type { ModelProvider } from "@/application/ports";
import { chatCompletionStream } from "@/infrastructure/deepseek/provider/features/Chat";
import { PartialStreamError } from "@/application/errors/PartialStreamError";
import { sendMessageStreaming } from "@/vscode/webviews/handlers/chat/streaming/Streaming";
import type { ProviderUsage } from "@/shared/usage/Usage";

suite("usage streaming", () => {
  test("parses the documented final DeepSeek usage chunk and requests it only from the official endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { choices: [{ delta: { content: "done" }, finish_reason: "stop" }], usage: null },
        {
          choices: [],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
            prompt_cache_hit_tokens: 8,
            prompt_cache_miss_tokens: 2,
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        },
      ]);
    }) as typeof fetch;

    try {
      const chunks: StreamChunk[] = [];
      await chatCompletionStream({
        request: { model: "deepseek-flash", messages: [{ role: "user", content: "hello" }], stream: true },
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        onChunk: (chunk) => chunks.push(chunk),
      });
      await chatCompletionStream({
        request: { model: "custom", messages: [{ role: "user", content: "hello" }], stream: true },
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        onChunk: () => undefined,
      });

      assert.deepStrictEqual(chunks.find((chunk) => chunk.type === "usage")?.usage, {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        prompt_cache_hit_tokens: 8,
        prompt_cache_miss_tokens: 2,
        reasoning_tokens: 3,
      });
      assert.deepStrictEqual((requestBodies[0] as { stream_options?: unknown }).stream_options, { include_usage: true });
      assert.strictEqual((requestBodies[1] as { stream_options?: unknown }).stream_options, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reports one provider request after duplicate usage chunks", async () => {
    const reported: Array<ProviderUsage | undefined> = [];
    const first = usage(10, 2);
    const last = usage(11, 3);
    await sendMessageStreaming({
      messages: [],
      payload: payload(),
      config: DEFAULT_CONFIG,
      provider: fakeProvider(async (_request, onChunk) => {
        onChunk({ type: "content", content: "done" });
        onChunk({ type: "usage", usage: first });
        onChunk({ type: "usage", usage: last });
        onChunk({ type: "done", finish_reason: "stop" });
      }),
      eventSink: fakeEventSink(),
      signal: new AbortController().signal,
      onUsage: (value) => reported.push(value),
    });
    assert.deepStrictEqual(reported, [last]);
  });

  test("reports partial streamed usage exactly once when the terminal marker fails", async () => {
    const reported: Array<ProviderUsage | undefined> = [];
    const finalUsage = usage(10, 2);
    await assert.rejects(
      sendMessageStreaming({
        messages: [],
        payload: payload(),
        config: DEFAULT_CONFIG,
        provider: fakeProvider(async (_request, onChunk) => {
          onChunk({ type: "content", content: "partial" });
          onChunk({ type: "usage", usage: finalUsage });
          throw new Error("missing terminal marker");
        }),
        eventSink: fakeEventSink(),
        signal: new AbortController().signal,
        onUsage: (value) => reported.push(value),
      }),
      PartialStreamError,
    );
    assert.deepStrictEqual(reported, [finalUsage]);
  });

  test("counts a completed stream whose provider omitted usage", async () => {
    const reported: Array<ProviderUsage | undefined> = [];
    await sendMessageStreaming({
      messages: [],
      payload: payload(),
      config: DEFAULT_CONFIG,
      provider: fakeProvider(async (_request, onChunk) => {
        onChunk({ type: "content", content: "done" });
        onChunk({ type: "done", finish_reason: "stop" });
      }),
      eventSink: fakeEventSink(),
      signal: new AbortController().signal,
      onUsage: (value) => reported.push(value),
    });
    assert.deepStrictEqual(reported, [undefined]);
  });

  test("reports one logical request when a provider safely retries before streaming", async () => {
    const reported: Array<ProviderUsage | undefined> = [];
    let attempts = 0;
    await sendMessageStreaming({
      messages: [],
      payload: payload(),
      config: DEFAULT_CONFIG,
      provider: fakeProvider(async (_request, onChunk) => {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          attempts += 1;
          if (attempt === 1) {
            continue;
          }
          onChunk({ type: "content", content: "done" });
          onChunk({ type: "usage", usage: usage(10, 2) });
          onChunk({ type: "done", finish_reason: "stop" });
        }
      }),
      eventSink: fakeEventSink(),
      signal: new AbortController().signal,
      onUsage: (value) => reported.push(value),
    });
    assert.strictEqual(attempts, 2);
    assert.strictEqual(reported.length, 1);
  });
});

function fakeProvider(chatCompletionStreamImpl: ModelProvider["chatCompletionStream"]): ModelProvider {
  return { chatCompletionStream: chatCompletionStreamImpl } as ModelProvider;
}

function fakeEventSink() {
  return { publish: () => undefined };
}

function payload() {
  return { clientRequestId: "request-1", text: "hello", modelId: "deepseek-flash", reasoning: "high" };
}

function usage(prompt: number, completion: number): ProviderUsage {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_cache_hit_tokens: prompt,
    prompt_cache_miss_tokens: 0,
  };
}

function sseResponse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

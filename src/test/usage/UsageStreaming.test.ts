import * as assert from "node:assert";
import type { ChatMessage, ChatCompletionRequest, StreamChunk } from "@/contracts";
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

  for (const [finishReason, diagnostic] of [
    ["length", /output limit/], ["content_filter", /filtered/],
    ["insufficient_system_resource", /resources were insufficient/],
    [undefined, /without a terminal finish reason/], [null, /without a terminal finish reason/],
    ["unsupported", /unsupported finish reason/],
  ] as const) {
    for (const partial of [false, true]) {
      test(`rejects incomplete finish ${String(finishReason)} and retains partial content=${partial}`, async () => {
        await assert.rejects(sendMessageStreaming({ messages: [], payload: payload(), config: DEFAULT_CONFIG,
          provider: fakeProvider(async (_request, onChunk) => {
            if (partial) { onChunk({ type: "content", content: "Incomplete answer" }); }
            // Exercise a malformed nullable terminal marker at the provider boundary too.
            onChunk({ type: "done", finish_reason: finishReason as string | undefined });
          }), eventSink: fakeEventSink(), signal: new AbortController().signal,
        }), (error: unknown) => {
          assert.ok(error instanceof Error); assert.match(error.message, diagnostic);
          assert.strictEqual(error instanceof PartialStreamError, partial);
          if (error instanceof PartialStreamError) {
            assert.strictEqual(error.partial.content, "Incomplete answer"); assert.strictEqual(error.reason, "failed");
          }
          return true;
        });
      });
    }
  }

  for (const systemContent of [undefined, null, "Project instructions"] as const) {
    test(`recovers once from excessive reasoning with system=${String(systemContent)}`, async () => {
      const requests: ChatCompletionRequest[] = []; const events: Array<Record<string, unknown>> = [];
      const messages: ChatMessage[] = [
        ...(systemContent === undefined ? [] : [{ role: "system" as const, content: systemContent }]),
        { role: "user", content: "Answer concisely" },
      ];
      const original = structuredClone(messages);
      const result = await sendMessageStreaming({ messages, payload: payload(), config: { ...DEFAULT_CONFIG, maxTokens: 128 },
        provider: fakeProvider(async (request, onChunk, signal) => {
          requests.push(request);
          onChunk({ type: "reasoning", reasoning_content: "r".repeat(310) });
          if (requests.length === 1) { signal!.throwIfAborted(); throw new Error("Reasoning guard failed to abort"); }
          assert.strictEqual(signal!.aborted, false);
          onChunk({ type: "content", content: "Concise answer" }); onChunk({ type: "done", finish_reason: "stop" });
        }), eventSink: { publish: event => { events.push(event); } }, signal: new AbortController().signal,
      });
      assert.strictEqual(requests.length, 2); assert.strictEqual(result.content, "Concise answer");
      assert.strictEqual(requests[0].thinking?.type, "enabled"); assert.strictEqual(requests[1].thinking?.type, "disabled");
      assert.strictEqual(requests[1].reasoning_effort, undefined);
      if (systemContent !== undefined) { assert.match(String(requests[1].messages[0].content), /<concise_recovery>/); }
      assert.strictEqual(events.filter(event => event.type === "generationRecoveryStarted").length, 1);
      assert.deepStrictEqual(messages, original);
    });
  }

  test("propagates a provider failure before any output without disguising it as partial content", async () => {
    const failure = new Error("provider unavailable");
    await assert.rejects(sendMessageStreaming({ messages: [], payload: payload(), config: DEFAULT_CONFIG,
      provider: fakeProvider(async () => { throw failure; }), eventSink: fakeEventSink(), signal: new AbortController().signal,
    }), error => error === failure);
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

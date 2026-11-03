import * as assert from "assert";
import type { ChatCompletionRequest, ChatCompletionResponse, StreamChunk } from "@/contracts";
import { DEFAULT_CONFIG } from "@/contracts/Config";
import { ContextCompactor } from "@/application/chat/context/ContextCompaction";
import {
  assertRequestFitsContext,
  estimateRequestTokens,
  getContextBudget,
} from "@/application/chat/context/ContextBudget";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import { compactToolCycleContext } from "@/application/chat/context/ToolCycleCompaction";
import type { ModelProvider } from "@/application/ports";

suite("Context budget and compaction", () => {
  test("reserves model output and a safety margin while counting tool schemas", () => {
    const budget = getContextBudget("deepseek-flash", 8_192);
    assert.strictEqual(budget.contextTokens, 1_000_000);
    assert.strictEqual(budget.safetyMarginTokens, 50_000);
    assert.strictEqual(budget.inputTokens, 941_808);

    const messages = [{ role: "user" as const, content: "hello" }];
    const withoutTools = estimateRequestTokens(messages);
    const withTools = estimateRequestTokens(messages, [{
      type: "function",
      function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } },
    }]);
    assert.ok(withTools > withoutTools);
    assert.doesNotThrow(() => assertRequestFitsContext(messages, [], "deepseek-flash", 8_192));
  });

  test("uses the documented V4 limits with the maximum default output allowance", () => {
    assert.strictEqual(DEFAULT_CONFIG.maxTokens, 384_000);
    const budget = getContextBudget(DEFAULT_CONFIG.model, DEFAULT_CONFIG.maxTokens);
    assert.strictEqual(budget.contextTokens, 1_000_000);
    assert.strictEqual(budget.outputTokens, 384_000);
    assert.strictEqual(budget.inputTokens, 566_000);
  });

  test("stops reasoning-dominated output preventively and allows one concise recovery", () => {
    const manager = new GenerationBudgetManager("deepseek-flash", 1_000);
    const assessment = manager.observeOutput("r".repeat(2_500), "");
    assert.strictEqual(assessment.status, "output_reasoning_limit");
    assert.strictEqual(manager.canRecoverConcise(), true);
    manager.recordConciseRecovery();
    assert.strictEqual(manager.canRecoverConcise(), false);
    assert.strictEqual(manager.observeOutput("short", "answer").status, "within_budget");
  });

  test("calibrates request estimates from provider prompt usage and enforces the calibrated hard limit", () => {
    const manager = new GenerationBudgetManager("deepseek-flash", 8_192);
    const calibrationMessages = [{ role: "user" as const, content: "calibrate" }];
    const baseline = estimateRequestTokens(calibrationMessages);
    manager.recordPromptUsage(calibrationMessages, [], {
      prompt_tokens: baseline * 2,
      completion_tokens: 1,
      total_tokens: baseline * 2 + 1,
    });

    const request = [{ role: "user" as const, content: "x".repeat(1_400_000) }];
    assert.strictEqual(
      manager.assessRequest(request, []).estimatedTokens,
      estimateRequestTokens(request) * 2,
    );
    assert.throws(() => manager.assertRequestFitsContext(request, []), /calibrated hard limit/);
  });

  test("allows exactly three automatic compactions per generation", () => {
    const manager = new GenerationBudgetManager("deepseek-flash", 8_192);
    for (let index = 0; index < 3; index += 1) {
      assert.strictEqual(manager.canCompactAutomatically(), true);
      manager.recordAutomaticCompaction();
    }
    assert.strictEqual(manager.canCompactAutomatically(), false);
  });

  test("compacts a tool cycle that jumps directly to the hard limit", () => {
    const manager = new GenerationBudgetManager("deepseek-flash", 8_192);
    const compacted = compactToolCycleContext(
      manager,
      [
        { role: "system", content: "system" },
        { role: "user", content: "old context".repeat(220_000) },
      ],
      [],
      "finish the requested change",
      [],
      3,
    );

    assert.ok(compacted);
    assert.ok(compacted.estimatedTokensAfter < compacted.estimatedTokensBefore);
    assert.match(String(compacted.messages[1].content ?? ""), /tool_cycle_continuation/);
  });

  test("does not report a tool-cycle compaction when continuity would not reduce the request", () => {
    const manager = new GenerationBudgetManager("deepseek-flash", 8_192);
    const compacted = compactToolCycleContext(
      manager,
      [{ role: "system", content: "s".repeat(2_300_000) }, { role: "user", content: "x" }],
      [],
      "x",
      [],
      1,
    );

    assert.strictEqual(compacted, undefined);
  });

  test("uses DeepSeek with thinking and tools disabled and extracts literal selected ranges", async () => {
    const provider = new StubProvider();
    const lines = Array.from({ length: 500 }, (_, index) => `literal line ${index + 1}`);
    const signal = new AbortController().signal;
    const compactor = new ContextCompactor(provider, "deepseek-flash", signal);
    const [file] = await compactor.compactFiles([{
      path: "src/large.ts",
      type: "file",
      content: lines.join("\n"),
    }], "inspect the relevant code");

    assert.strictEqual(provider.requests.length, 1);
    assert.deepStrictEqual(provider.requests[0].thinking, { type: "disabled" });
    assert.strictEqual(provider.requests[0].tool_choice, "none");
    assert.strictEqual(provider.requests[0].max_tokens, 512);
    assert.strictEqual(provider.signals[0], signal);
    assert.ok(file.content?.includes("literal line 10"));
    assert.ok(file.content?.includes("literal line 12"));
    assert.ok(!file.content?.includes("literal line 100"));
  });

  test("reserves a wider ceiling for prose summaries than for range selection", async () => {
    const provider = new StubProvider("summary");
    const compactor = new ContextCompactor(provider, "deepseek-flash", new AbortController().signal);
    await compactor.summarize([{
      generationId: "generation-1",
      visibleText: "context",
      messages: [{ role: "user", content: "context" }],
    }]);

    assert.deepStrictEqual(provider.requests[0].thinking, { type: "disabled" });
    assert.strictEqual(provider.requests[0].max_tokens, 2_048);
  });

  test("does not build or send a numbered auxiliary request for a huge single-line file", async () => {
    const provider = new StubProvider();
    const [file] = await new ContextCompactor(
      provider,
      "deepseek-flash",
      new AbortController().signal,
    ).compactFiles([{
      path: "dist/minified.js",
      type: "file",
      content: `const marker=true;${"x".repeat(300 * 1024)}`,
    }], "find marker");

    assert.strictEqual(provider.requests.length, 0);
    assert.ok(Buffer.byteLength(file.content ?? "", "utf8") <= 96 * 1024);
    assert.ok(file.content?.includes("const marker=true"));
  });

  test("sorts and merges overlapping selected ranges without duplicating source", async () => {
    const provider = new StubProvider('{"ranges":[{"start":20,"end":30},{"start":10,"end":22},{"start":40,"end":42}]}');
    const lines = Array.from({ length: 500 }, (_, index) => `unique line ${index + 1}`);
    const [file] = await new ContextCompactor(
      provider,
      "deepseek-flash",
      new AbortController().signal,
    ).compactFiles([{ path: "src/large.ts", type: "file", content: lines.join("\n") }], "inspect");

    assert.ok((file.content?.indexOf("unique line 10") ?? -1) < (file.content?.indexOf("unique line 40") ?? -1));
    assert.strictEqual(file.content?.match(/unique line 20(?:\n|$)/g)?.length, 1);
    assert.strictEqual(file.content?.match(/\/\* lines /g)?.length, 2);
  });

  test("keeps cumulative summary coverage but stores only the new boundary delta", async () => {
    const provider = new StubProvider("summary");
    const compactor = new ContextCompactor(provider, "deepseek-flash", new AbortController().signal);
    const first = await compactor.summarize([{
      generationId: "generation-1",
      visibleText: "first",
      messages: [{ role: "user", content: "first" }],
    }]);
    const second = await compactor.summarize([{
      generationId: "generation-2",
      visibleText: "second",
      messages: [{ role: "user", content: "second" }],
    }], first);

    assert.deepStrictEqual(second.coveredGenerationIds, ["generation-1", "generation-2"]);
    assert.deepStrictEqual(second.boundaries?.at(-1)?.coveredGenerationIds, ["generation-2"]);
  });

  test("propagates cancellation without falling back to a local summary", async () => {
    const provider = new StubProvider("summary");
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      new ContextCompactor(provider, "deepseek-flash", controller.signal).summarize([{
        generationId: "cancelled-generation",
        visibleText: "cancelled",
        messages: [{ role: "user", content: "cancelled" }],
      }]),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    assert.strictEqual(provider.requests.length, 0);
  });

  test("retains local evidence and attributes an unavailable compaction request to its model", async () => {
    const observed: unknown[] = [];
    const provider = {
      chatCompletion: async (request: ChatCompletionRequest) => {
        assert.strictEqual(request.model, "unavailable-model");
        assert.deepStrictEqual(request.thinking, { type: "disabled" });
        throw new Error("model unavailable");
      },
    };
    const summary = await new ContextCompactor(provider, "unavailable-model", new AbortController().signal, 4,
      (phase, usage, model) => {observed.push({ phase, usage, model });},
    ).summarize([{ generationId: "g", visibleText: "Required verification remains pending.", messages: [] }]);
    assert.strictEqual(summary.provider, "local");
    assert.match(summary.content, /Required verification remains pending/);
    assert.deepStrictEqual(observed, [{ phase: "context_summary", usage: undefined, model: "unavailable-model" }]);
  });
});

class StubProvider implements ModelProvider {
  readonly name = "stub";
  readonly id = "stub";
  readonly requests: ChatCompletionRequest[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];

  constructor(private readonly responseContent = "{\"ranges\":[{\"start\":10,\"end\":12}]}") {}

  async chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    this.signals.push(signal);
    return {
      id: "response",
      object: "chat.completion",
      created: 1,
      model: request.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: this.responseContent },
        finish_reason: "stop",
      }],
    };
  }

  async chatCompletionStream(
    _request: ChatCompletionRequest,
    _onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {}

  async testConnection(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    return [];
  }
}

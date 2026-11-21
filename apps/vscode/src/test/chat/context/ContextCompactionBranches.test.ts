import * as assert from "node:assert/strict";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/contracts";
import {
  ContextCompactor,
  referencedFileNeedsCompaction,
  type ContextCompactionProvider,
} from "@/application/chat/context/ContextCompaction";
import type { ConversationContextSummary } from "@/application/chat/ProviderTranscript";
import type { ProviderUsage, UsagePhase } from "@/shared/usage/Usage";

class StubProvider implements ContextCompactionProvider {
  readonly requests: ChatCompletionRequest[] = [];
  constructor(private readonly replies: Array<string | Error | ErrorConstructor> = []) {}

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply instanceof Error) { throw reply; }
    return {
      choices: [{ message: { role: "assistant", content: typeof reply === "string" ? reply : "summary" } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    } as ChatCompletionResponse;
  }
}

function unit(generationId: string, visibleText: string) {
  return { generationId, visibleText, messages: [{ role: "user" as const, content: visibleText }] };
}

function summary(content: string, coveredGenerationIds: string[] = []): ConversationContextSummary {
  return {
    schemaVersion: 2, provider: "deepseek", content, coveredGenerationIds, sourceDigest: "digest", updatedAt: 1, boundaries: [],
  };
}

suite("context compaction branches", () => {
  for (const raw of ['{}', '{"ranges":[null]}', '{"ranges":[{"start":5,"end":2}]}', '{"ranges":[{"start":1,"end":999}]}', '{"ranges":[]}']) {
    test(`falls back to literal local ranges for malformed selection ${raw}`, async () => {
      const provider = new StubProvider([raw]);
      const content = Array.from({ length: 500 }, (_, i) => i === 250 ? "const requiredMarker = true;" : `source ${i + 1}`).join("\n");
      const [file] = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal)
        .compactFiles([{ path: "src/file.ts", type: "file", content }], "requiredMarker");
      assert.match(file.content!, /const requiredMarker = true;/); assert.match(file.content!, /lines/);
      assert.equal(provider.requests.length, 1);
    });
  }
  test("uses local file excerpts without provider calls when the auxiliary call limit is zero", async () => {
    const provider = new StubProvider();
    const content = Array.from({ length: 500 }, (_, i) => `source ${i}`).join("\n");
    const [file] = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal, 0)
      .compactFiles([{ path: "src/file.ts", type: "file", content }], "source");
    assert.equal(provider.requests.length, 0); assert.match(file.content!, /lines/);
  });
  for (const abortAfterResponse of [false, true]) {
    test(`propagates file compaction cancellation after response=${abortAfterResponse}`, async () => {
      const controller = new AbortController(); let calls = 0;
      const provider: ContextCompactionProvider = { chatCompletion: async () => {
        calls++; controller.abort(); return { choices: [{ message: { role: "assistant", content: '{"ranges":[{"start":1,"end":2}]}' } }] } as ChatCompletionResponse;
      } };
      if (!abortAfterResponse) { controller.abort(); }
      const operation = new ContextCompactor(provider, "deepseek-flash", controller.signal)
        .compactFiles([{ path: "src/file.ts", type: "file", content: "line\n".repeat(500) }], "line");
      await assert.rejects(operation, { name: "AbortError" }); assert.equal(calls, abortAfterResponse ? 1 : 0);
    });
  }
  for (const oversizedSecondPart of [false, true]) {
    test(`retains earlier source while chunking separate generations, oversized part=${oversizedSecondPart}`, async () => {
      const provider = new StubProvider(["part one", "part two", "merged", "final merged"]);
      const units = oversizedSecondPart ? [unit("first", "Keep this earlier context"), unit("second", "x".repeat(220 * 1024))]
        : [unit("first", "a".repeat(100 * 1024)), unit("second", "b".repeat(100 * 1024))];
      const result = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal).summarize(units);
      assert.deepEqual(result.coveredGenerationIds, ["first", "second"]);
      assert.equal(provider.requests.length, oversizedSecondPart ? 4 : 3);
      assert.match(String(provider.requests[0].messages[1].content), /first/);
      assert.equal(result.content, oversizedSecondPart ? "final merged" : "merged");
    });
  }

  test("reuses earlier coverage while summarizing new generations", async () => {
    const provider = new StubProvider(["fresh summary"]);
    const previous = summary("earlier", ["generation-1"]);
    const result = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal)
      .summarize([unit("generation-1", "repeated"), unit("generation-2", "new")], previous);

    assert.deepEqual(result.coveredGenerationIds, ["generation-1", "generation-2"]);
    assert.equal(result.content, "fresh summary");
    assert.match(String(provider.requests[0]!.messages[1]!.content), /Previous summary:\nearlier/);
    assert.match(String(provider.requests[0]!.messages[1]!.content), /<generation id="generation-2">/);
    assert.deepEqual(result.boundaries?.at(-1)?.coveredGenerationIds, ["generation-1", "generation-2"]);
  });

  test("merges the summaries of split sources", async () => {
    const provider = new StubProvider(["first part", "second part", "combined"]);
    const result = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal)
      .summarize([unit("generation", `${"a".repeat(70 * 1024)} ${"b".repeat(70 * 1024)} ${"c".repeat(70 * 1024)}`)]);

    assert.equal(provider.requests.length, 3);
    assert.equal(result.content, "combined");
  });

  test("keeps raw chunks when the call budget is exhausted", async () => {
    const provider = new StubProvider(["only summary"]);
    const result = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal, 1)
      .summarize([unit("generation", "y".repeat(250 * 1024))]);

    assert.ok(provider.requests.length <= 1);
    assert.equal(result.coveredGenerationIds.at(-1), "generation");
    assert.ok(result.content.length > 0);
  });

  test("falls back to a local summary when the provider returns nothing", async () => {
    const provider = new StubProvider(["   "]);
    const result = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal)
      .summarize([unit("generation", "context")]);

    assert.equal(result.provider, "local");
    assert.equal(result.content, "context");
  });

  test("bounds large local summaries and keeps earlier context", async () => {
    const provider = new StubProvider([new Error("provider offline")]);
    const previous = summary("earlier", ["generation-1"]);
    const result = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal)
      .summarize([unit("generation-2", "z".repeat(40_000))], previous);

    assert.equal(result.provider, "local");
    assert.match(result.content, /Earlier context:/);
    assert.match(result.content, /\[older detail compacted locally\]/);
    assert.ok(Buffer.byteLength(result.content, "utf8") <= 24_000);
  });

  test("propagates cancellation instead of summarizing locally", async () => {
    const controller = new AbortController();
    const provider = new StubProvider([new Error("late failure")]);
    const compactor = new ContextCompactor(provider, "deepseek-flash", controller.signal);
    controller.abort();

    await assert.rejects(compactor.summarize([unit("generation", "context")]), { name: "AbortError", message: /Context compaction cancelled/ });
  });

  test("reports usage for every auxiliary call", async () => {
    const phases: UsagePhase[] = [];
    const usages: Array<ProviderUsage | undefined> = [];
    const prompts: Array<ChatCompletionRequest["messages"]> = [];
    await new ContextCompactor(new StubProvider(["summary"]), "deepseek-flash", new AbortController().signal, 4,
      (phase, usage) => { phases.push(phase); usages.push(usage); },
      (messages) => { prompts.push(messages); })
      .summarize([unit("generation", "context")]);

    assert.deepEqual(phases, ["context_summary"]);
    assert.equal(usages[0]?.total_tokens, 5);
    assert.equal(prompts.length, 1);
  });

  test("compacts only oversized files and keeps directories untouched", async () => {
    const provider = new StubProvider(['{"ranges":[{"start":2,"end":4}]}']);
    const lines = Array.from({ length: 500 }, (_, index) => `content line ${index + 1}`);
    const files = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal).compactFiles([
      { path: "src/small.ts", type: "file", content: "const tiny = 1;" },
      { path: "src/folder", type: "directory" },
      { path: "src/large.ts", type: "file", content: lines.join("\n") },
    ], "inspect the large file");

    assert.equal(files[0]!.content, "const tiny = 1;");
    assert.equal(files[1]!.content, undefined);
    assert.match(String(files[2]!.content), /\/\* lines 2-4;/);
    assert.match(String(files[2]!.content), /content line 2/);
    assert.equal(provider.requests.length, 1);
  });

  test("falls back to local ranges when range selection fails", async () => {
    const provider = new StubProvider([new Error("selection unavailable")]);
    const lines = Array.from({ length: 500 }, (_, index) => index === 300 ? "const marker = computeMarker();" : `line ${index + 1}`);
    const [file] = await new ContextCompactor(provider, "deepseek-flash", new AbortController().signal)
      .compactFiles([{ path: "src/large.ts", type: "file", content: lines.join("\n") }], "computeMarker");

    assert.match(String(file!.content), /computeMarker/);
    assert.match(String(file!.content), /\/\* lines /);
    assert.ok(!String(file!.content).includes("line 1\n"));
  });

  test("identifies the files that need compaction", () => {
    assert.equal(referencedFileNeedsCompaction({ path: "a.ts", type: "file" }), false);
    assert.equal(referencedFileNeedsCompaction({ path: "a", type: "directory", content: "x".repeat(10) }), false);
    assert.equal(referencedFileNeedsCompaction({ path: "a.ts", type: "file", content: "short" }), false);
    assert.equal(referencedFileNeedsCompaction({ path: "a.ts", type: "file", content: Array.from({ length: 401 }, () => "x").join("\n") }), true);
    assert.equal(referencedFileNeedsCompaction({ path: "a.ts", type: "file", content: "x".repeat(97 * 1024) }), true);
  });
});

import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "@/contracts";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { CompletionService, cleanCompletion } from "@/vscode/completions/CompletionService";
import type { CodeCompletionRequest } from "@/contracts/CodeCompletion";
import type { createBetaCodeCompleter } from "@/infrastructure/deepseek/provider/features/CodeCompletion";

function fixture() {
  let config = { ...DEFAULT_CONFIG, betaFeaturesEnabled: true };
  let revision = 1;
  let trusted = true;
  let credentials = 0;
  let calls = 0;
  let run: (request: CodeCompletionRequest, signal?: AbortSignal) => Promise<string> = async () => "return 1;";
  let finishReason = "stop";
  const requests: CodeCompletionRequest[] = [];
  const factory: typeof createBetaCodeCompleter = (snapshot, enabled, onUsage) => async (request, signal) => {
    assert.equal(snapshot.thinkingMode, false);
    assert.equal(snapshot.apiKey, "fixture-key");
    assert.equal(enabled(), true);
    calls++;
    requests.push(request);
    const content = await run(request, signal);
    onUsage({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }, snapshot.model);
    return JSON.stringify({ content, finish_reason: finishReason });
  };
  const settings = { load: () => config, getRevision: () => revision, waitForPendingWrites: async () => undefined } as unknown as SettingsRepository;
  const secrets = { getApiKey: async (origin: string) => {assert.equal(origin, config.baseUrl); credentials++; return "fixture-key";} } as unknown as SecretStore;
  const modelCalls: Array<{ beta: boolean; thinking: boolean }> = [];
  const models = { create: (snapshot: typeof config) => ({ chatCompletion: async () => {
    modelCalls.push({ beta: snapshot.betaFeaturesEnabled, thinking: snapshot.thinkingMode });
    return { choices: [{ finish_reason: finishReason, message: { content: "```ts\nconst value = 1;\n```" } }],
      usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 } };
  } }) } as unknown as ModelProviderFactory;
  let usageCount = 0;
  let context = "";
  const service = new CompletionService(settings, secrets, models, () => trusted, usage => {usageCount = usage.count;}, factory, async () => context);
  return { service, requests, modelCalls, setContext: (value: string) => {context = value;}, counts: () => ({ credentials, calls, usageCount }),
    configure: (patch: Partial<typeof config>) => {config = { ...config, ...patch }; revision++;},
    untrust: () => {trusted = false;}, run: (callback: typeof run) => {run = callback;},
    finish: (value: string) => {finishReason = value;} };
}

suite("interactive completions", () => {
  test("respects beta, per-surface settings and trust before reading credentials", async () => {
    const f = fixture();
    f.configure({ betaFeaturesEnabled: false });
    assert.equal(await f.service.suggest("editor", "const x = ", ""), "");
    f.configure({ betaFeaturesEnabled: true, editorSuggestionsEnabled: false });
    assert.equal(await f.service.suggest("editor", "const x = ", ""), "");
    f.configure({ chatSuggestionsEnabled: false });
    assert.equal(await f.service.suggest("chat", "Write a test", ""), "");
    f.untrust();
    assert.equal(await f.service.suggest("editor", "const x = ", ""), "");
    assert.deepEqual(f.counts(), { credentials: 0, calls: 0, usageCount: 0 });
  });

  test("uses bounded FIM context and preserves whitespace", async () => {
    const f = fixture();
    f.run(async () => "  return value;\n");
    assert.equal(await f.service.suggest("editor", "function f() {\n", "\n}"), "  return value;\n");
    assert.deepEqual(f.requests[0], { mode: "fim", prefix: "function f() {\n", suffix: "\n}", maxTokens: 256 });
    assert.equal(f.counts().usageCount, 1);
    assert.equal(await f.service.suggest("editor", "x".repeat(12_001), ""), "");
    assert.equal(f.counts().calls, 1);
  });

  test("preserves FIM closing punctuation that also appears in the suffix", async () => {
    const f = fixture();
    f.run(async () => "Math.max(a, b)");
    const middle = await f.service.suggest("editor", "wrap(", ")");
    assert.equal(`wrap(${middle})`, "wrap(Math.max(a, b))");
    f.run(async () => "if (flag) { return 1; }");
    assert.equal(await f.service.suggest("editor", "function outer() { ", "}"), "if (flag) { return 1; }");
  });

  test("continues chat prompts instead of answering and uses a smaller token limit", async () => {
    const f = fixture();
    f.setContext('{"projects":[{"name":"DeepSeek Agent","description":"VS Code extension"}]}');
    await f.service.suggest("chat", "Ayúdame a crear ", "");
    assert.equal(f.requests[0].mode, "prefix");
    assert.ok(f.requests[0].instruction!.includes('{"projects":[{"name":"DeepSeek Agent","description":"VS Code extension"}]}'));
    assert.equal(f.requests[0].prefix, "Ayúdame a crear ");
    assert.equal(f.requests[0].maxTokens, 96);
  });

  test("supports an explicitly requested message for an empty draft and caches it", async () => {
    const f = fixture();
    f.setContext("DeepSeek Agent: VS Code extension");
    f.run(async () => "Explica la arquitectura de esta extensión");
    assert.equal(await f.service.suggest("chat", "", ""), "Explica la arquitectura de esta extensión");
    assert.equal(await f.service.suggest("chat", "", ""), "Explica la arquitectura de esta extensión");
    assert.equal(f.counts().calls, 1);
    assert.equal(f.requests[0].prefix, "");
    assert.ok(f.requests[0].instruction!.includes("DeepSeek Agent: VS Code extension"));
    assert.equal(await f.service.suggest("editor", "", ""), "");
    assert.equal(f.counts().calls, 1);
  });

  test("does not reuse chat suggestions across changed projects or affect editor context", async () => {
    const f = fixture();
    f.setContext("Project A");
    await f.service.suggest("chat", "Busca la función ", "");
    f.setContext("Project B");
    await f.service.suggest("chat", "Busca la función ", "");
    assert.equal(f.counts().calls, 2);
    assert.ok(f.requests[1].instruction!.includes("Project B"));
    assert.ok(!f.requests[1].instruction!.includes("Project A"));
    await f.service.suggest("editor", "const value = ", "");
    assert.equal(f.requests[2].instruction, undefined);
  });

  test("discards a chat continuation if the workspace changes during the request", async () => {
    const f = fixture();
    f.setContext("Project A");
    f.run(async () => {f.setContext("Project B"); return "stale project suggestion";});
    assert.equal(await f.service.suggest("chat", "Busca la función ", ""), "");
  });

  test("reuses cached suggestions without another paid request", async () => {
    const f = fixture();
    await f.service.suggest("editor", "const x = ", "");
    await f.service.suggest("editor", "const x = ", "");
    assert.equal(f.counts().calls, 1);
    f.service.invalidate();
    await f.service.suggest("editor", "const x = ", "");
    assert.equal(f.counts().calls, 2);
  });

  test("handles prefix APIs returning the whole prefix and preserves literal code fences", async () => {
    const f = fixture();
    f.run(async () => "Ayúdame con una prueba");
    assert.equal(await f.service.suggest("chat", "Ayúdame con ", ""), "una prueba");
    f.run(async () => "```js\nexample();\n```\n");
    assert.equal(await f.service.suggest("editor", "Write docs:\n", ""), "```js\nexample();\n```\n");
  });

  test("cancels superseded requests and never returns their stale text", async () => {
    const f = fixture();
    let release!: (value: string) => void;
    const started = new Promise<void>(resolve => f.run(async () => {resolve(); return await new Promise<string>(r => {release = r;});}));
    const first = f.service.suggest("editor", "const old = ", "");
    const rejected = assert.rejects(first, /abort/i);
    await started;
    f.run(async () => "2;");
    assert.equal(await f.service.suggest("editor", "const newer = ", ""), "2;");
    release("stale;");
    await rejected;
  });

  test("settings changes and explicit invalidation prevent in-flight suggestions appearing", async () => {
    for (const invalidate of [false, true]) {
      const f = fixture();
      let release!: (value: string) => void;
      const started = new Promise<void>(resolve => f.run(async () => {resolve(); return await new Promise<string>(r => {release = r;});}));
      const request = f.service.suggest("chat", "Write a function", "");
      const done = invalidate ? assert.rejects(request, /abort/i) : request.then(text => assert.equal(text, ""));
      await started;
      if (invalidate) {f.service.invalidate();} else {f.configure({ betaFeaturesEnabled: false });}
      release("stale");
      await done;
    }
  });

  test("stops requests during API failure cooldown and resumes after settings invalidation", async () => {
    const f = fixture();
    f.run(async () => {throw new Error("rate limit");});
    await assert.rejects(f.service.suggest("editor", "const x = ", ""), /rate limit/);
    assert.equal(await f.service.suggest("editor", "const y = ", ""), "");
    assert.equal(f.counts().calls, 1);
    f.service.invalidate(); f.run(async () => "1;");
    assert.equal(await f.service.suggest("editor", "const y = ", ""), "1;");
  });

  test("refactors with the stable API even when beta is disabled", async () => {
    const f = fixture(); f.configure({ betaFeaturesEnabled: false });
    assert.equal(await f.service.edit("refactor", "let value = 1;", "ts", "", "", new AbortController().signal), "const value = 1;");
    assert.deepEqual(f.modelCalls, [{ beta: false, thinking: false }]);
    assert.equal(f.counts().usageCount, 1);
    await assert.rejects(f.service.edit("complete", "function f()", "ts", "", "", new AbortController().signal), /beta/);
  });

  test("rejects truncated replacements for both menu actions", async () => {
    for (const action of ["complete", "refactor"] as const) {
      const f = fixture(); f.finish("length");
      await assert.rejects(f.service.edit(action, "function f()", "ts", "", "", new AbortController().signal), /truncated/);
    }
  });

  test("removes only surrounding code fences", () => {
    assert.equal(cleanCompletion("```python\n  return 1\n```"), "  return 1");
    assert.equal(cleanCompletion("  return 1;\n"), "  return 1;\n");
  });
});

import * as assert from "node:assert";
import { createHeadlessWebTools } from "@/infrastructure/browser/BrowserTools";

suite("web search tools", () => {
  test("opens a search result with the model's focus/query filter and null optional fields", async () => {
    let reads = 0;
    const tools = createHeadlessWebTools({ render: async () => {
      reads++;
      return { title: "API", url: "https://example.com/api", content: "Search endpoint", sections: ["Search endpoint", "Unrelated section"],
        outline: [], links: [], contentHash: "a".repeat(64), injectionRisk: "none" };
    } }, {
      systemLocale: () => "en", vscodeLanguage: () => "en",
      search: async () => ({ urls: ["https://example.com/api"], contentHash: "a".repeat(64) }),
    });
    const search = tools.find((tool) => tool.definition.function.name === "search_web")!;
    const read = tools.find((tool) => tool.definition.function.name === "read_web")!;
    const context = { generationId: "first" };
    const found = JSON.parse(await search.handler({ query: "API" }, context)) as { search_id: string; urls: string[] };
    for (const filter of [{ focus: "Search", query: null }, { query: "Search", focus: null }]) {
      const output = JSON.parse(await read.handler({ search_id: found.search_id, url: found.urls[0],
        document_id: null, cursor: null, ...filter }, context)) as { sections: Array<{ content: string }> };
      assert.deepStrictEqual(output.sections.map((section) => section.content), ["Search endpoint"]);
    }
    await assert.rejects(() => read.handler({ search_id: found.search_id, url: found.urls[0], cursor: "MA" }, context), /only valid with document_id/);
    assert.strictEqual(reads, 2);
  });

  test("passes validated search preferences and grants result URLs only to their generation", async () => {
    const controller = new AbortController();
    const tools = createHeadlessWebTools({ render: async () => { throw new Error("unexpected page request"); } }, {
      systemLocale: () => "es-ES",
      vscodeLanguage: () => "es",
      search: async (query, locale, limit, signal) => {
        assert.strictEqual(query, "release notes lang:es site:example.com");
        assert.strictEqual(locale.tag, "es-ES");
        assert.strictEqual(limit, 2);
        assert.strictEqual(signal, controller.signal);
        return { urls: ["https://example.com/releases"], contentHash: "a".repeat(64) };
      },
    });
    const search = tools.find((tool) => tool.definition.function.name === "search_web")!;
    const read = tools.find((tool) => tool.definition.function.name === "read_web")!;
    const result = JSON.parse(await search.handler({ query: "release notes", domains: ["example.com"], max_results: 2 }, {
      generationId: "first", signal: controller.signal,
    })) as { kind: string; provider: string; search_id: string; urls: string[] };
    assert.strictEqual(result.kind, "web_search_results");
    assert.strictEqual(result.provider, "deepseek");
    assert.deepStrictEqual(result.urls, ["https://example.com/releases"]);
    await assert.rejects(() => read.handler({ search_id: result.search_id, url: result.urls[0] }, {
      generationId: "second",
    }), /different generation/);
    await assert.rejects(() => read.handler({ search_id: result.search_id, url: "https://example.com/other" }, {
      generationId: "first",
    }), /not registered/);
  });

  test("reports a terminal provider failure once per generation without silently retrying", async () => {
    let calls = 0;
    const tools = createHeadlessWebTools({ render: async () => { throw new Error("unexpected page request"); } }, {
      systemLocale: () => "en-US", vscodeLanguage: () => "en",
      search: async () => { calls++; throw new Error("API access denied."); },
    });
    const search = tools.find((tool) => tool.definition.function.name === "search_web")!;
    const first = JSON.parse(await search.handler({ query: "release notes" }, { generationId: "first" })) as {
      kind: string; terminal: boolean; reason: string;
    };
    assert.strictEqual(first.kind, "web_search_failure");
    assert.strictEqual(first.terminal, true);
    assert.strictEqual(first.reason, "API access denied.");
    await search.handler({ query: "another search" }, { generationId: "first" });
    assert.strictEqual(calls, 1);
    await search.handler({ query: "release notes" }, { generationId: "second" });
    assert.strictEqual(calls, 2);
  });

  test("propagates cancellation instead of caching it as a terminal failure", async () => {
    const controller = new AbortController();
    const cancelled = new DOMException("Aborted", "AbortError");
    const tools = createHeadlessWebTools({ render: async () => { throw new Error("unexpected page request"); } }, {
      systemLocale: () => "en", vscodeLanguage: () => "en",
      search: async () => { controller.abort(); throw cancelled; },
    });
    const search = tools.find((tool) => tool.definition.function.name === "search_web")!;
    await assert.rejects(() => search.handler({ query: "release notes" }, {
      generationId: "first", signal: controller.signal,
    }), (error: unknown) => error === cancelled);
  });

  test("bounds summaries and URL grants together, and accepts a successful empty search", async () => {
    let empty = false;
    const tools = createHeadlessWebTools({ render: async () => { throw new Error("unexpected page request"); } }, {
      systemLocale: () => "en", vscodeLanguage: () => "en",
      search: async () => {
        const results = empty ? [] : Array.from({ length: 10 }, (_, index) => ({
          url: `https://example.com/${index}/${"x".repeat(3_000)}`, title: "Title", summary: "🌐".repeat(1_200),
        }));
        return { urls: results.map((item) => item.url), results, contentHash: "a".repeat(64) };
      },
    });
    const search = tools.find((tool) => tool.definition.function.name === "search_web")!;
    const read = tools.find((tool) => tool.definition.function.name === "read_web")!;
    const output = await search.handler({ query: "query" }, { generationId: "first" });
    assert.ok(Buffer.byteLength(output) <= 8 * 1024);
    const result = JSON.parse(output) as { search_id: string; urls: string[] };
    assert.ok(result.urls.length > 0 && result.urls.length < 10);
    await assert.rejects(() => read.handler({
      search_id: result.search_id, url: `https://example.com/9/${"x".repeat(3_000)}`,
    }, { generationId: "first" }), /not registered/);
    empty = true;
    const next = JSON.parse(await search.handler({ query: "query" }, { generationId: "second" })) as { kind: string; urls: string[] };
    assert.strictEqual(next.kind, "web_search_results");
    assert.deepStrictEqual(next.urls, []);
  });
});

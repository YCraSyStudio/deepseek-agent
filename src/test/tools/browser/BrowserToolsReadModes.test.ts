import * as assert from "node:assert";
import { createHeadlessWebTools } from "@/infrastructure/browser/BrowserTools";
import type { RenderedPage } from "@/infrastructure/browser/HeadlessWebRuntime";

const page: RenderedPage = {
  title: "Example",
  url: "https://example.com/page",
  content: "Alpha section\n\nBeta section",
  sections: ["Alpha section", "Beta section"],
  outline: [],
  links: [],
  contentHash: "a".repeat(64),
  injectionRisk: "none",
};

function preferences(overrides: Record<string, unknown> = {}) {
  return {
    systemLocale: () => "en",
    vscodeLanguage: () => "en",
    ...overrides,
  };
}

function tools(render: (url: string) => Promise<RenderedPage> = async () => page, overrides: Record<string, unknown> = {}) {
  return createHeadlessWebTools({ render }, preferences(overrides));
}

const context = { generationId: "generation-1", trustedUserRequest: "Read https://example.com/page" };

suite("web read modes", () => {
  test("reopens a retained document by id with a cursor, filter and generation ownership", async () => {
    const [, read] = tools(async () => page);
    const first = JSON.parse(await read.handler({ url: "https://example.com/page" }, context)) as { document_id: string };
    assert.match(first.document_id, /^document_/);

    const cursor = Buffer.from("0", "utf8").toString("base64url");
    const filtered = JSON.parse(await read.handler({ document_id: first.document_id, cursor, query: "Alpha" }, context)) as {
      kind: string;
      sections: Array<{ content: string }>;
    };
    assert.strictEqual(filtered.kind, "web_document_fragment");
    assert.deepStrictEqual(filtered.sections.map((section) => section.content), ["Alpha section"]);

    await assert.rejects(() => read.handler({ document_id: first.document_id }, { generationId: "other" }), /different generation/);
    await assert.rejects(() => read.handler({ document_id: first.document_id, cursor: "!!!" }, context), /cursor must be a cursor/);
    await assert.rejects(() => read.handler({ document_id: "document_missing" }, context), /unknown or expired/);
  });

  test("rejects ambiguous, incomplete and conflicting read sources", async () => {
    const [, read] = tools();
    await assert.rejects(() => read.handler({ search_id: "search_1", document_id: "document_1" }, context), /exactly one source/);
    await assert.rejects(() => read.handler({ search_id: "search_1" }, context), /url is required with search_id/);
    await assert.rejects(
      () => read.handler({ document_id: "document_1", focus: "Alpha" }, context),
      /url and focus are not valid with document_id/,
    );
    await assert.rejects(() => read.handler({ url: "https://example.com/page", cursor: "MA" }, context), /only valid with document_id/);
    await assert.rejects(() => read.handler({ url: "https://example.com/page" }, { generationId: "generation-1" }), /current user message/);
    await assert.rejects(() => read.handler({ url: "https://example.com/page", focus: "Alpha", query: "Beta" }, context), /only one reading filter/);
    await assert.rejects(() => read.handler({ url: "http://example.com/page" }, context), /HTTPS|public|private/i);
  });

  test("treats an https document_id as a direct URL and reuses search results by URL", async () => {
    let renders = 0;
    const [search, read] = tools(async () => { renders += 1; return page; }, {
      search: async () => ({
        urls: ["https://example.com/page"],
        results: [{ url: "https://example.com/page", title: "Example", summary: "Summary", content: "Retained body" }],
        contentHash: "a".repeat(64),
      }),
    });
    const found = JSON.parse(await search.handler({ query: "example" }, context)) as { search_id: string };
    assert.match(found.search_id, /^search_/);

    const implicit = JSON.parse(await read.handler({ url: "https://example.com/page" }, context)) as { kind: string; sections: Array<{ content: string }> };
    assert.ok(implicit.sections.some((section) => section.content.includes("Retained body")));
    assert.strictEqual(renders, 0);

    const asDocument = JSON.parse(await read.handler({ document_id: "https://example.com/page" }, context)) as { document_id: string };
    assert.match(asDocument.document_id, /^document_/);
  });

  test("sanitizes page render failures", async () => {
    const cases: Array<[string, RegExp]> = [
      ["Stream cancelled by the user", /Web operation was cancelled/],
      ["request timeout", /Web request timed out/],
      ["unsupported content type text/plain", /did not return readable text content/],
      ["x".repeat(300), /The authorized web page could not be read/],
    ];
    for (const [message, expected] of cases) {
      const [, read] = tools(async () => { throw new Error(message); });
      await assert.rejects(() => read.handler({ url: "https://example.com/page" }, context), expected);
    }
  });
});

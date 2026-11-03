import * as assert from "node:assert";
import { createNormalizedDocument, extractSemanticDocument, selectDocumentContent } from "@/infrastructure/browser/SemanticContent";

suite("semantic browser content", () => {
  test("groups each h1 with following subtitles and paragraphs", () => {
    const document = extractSemanticDocument([
      "Page Title: Guide",
      "URL: https://example.com/guide",
      "Snapshot:",
      "- main:",
      '  - heading "First" [level=1]',
      '  - heading "Details" [level=2]',
      "  - paragraph: First paragraph.",
      '  - heading "Second" [level=1]',
      "  - paragraph: Second paragraph.",
      "  - listitem: excluded list item",
      "  - code: excluded code",
    ].join("\n"), "https://example.com/guide");

    assert.deepStrictEqual(document.sections, [
      { id: 1, content: "First\n\nDetails\n\nFirst paragraph." },
      { id: 2, content: "Second\n\nSecond paragraph." },
    ]);
  });

  test("uses the document title before the first h1 and when no h1 exists", () => {
    const document = extractSemanticDocument([
      "Page Title: Releases",
      "URL: https://example.com/releases",
      "Snapshot:",
      "- paragraph: Introductory text.",
      '  - heading "Stable" [level=2]',
      "  - paragraph: Stable details.",
    ].join("\n"), "https://example.com/releases");

    assert.deepStrictEqual(document.sections, [{
      id: 1,
      content: "Releases\n\nIntroductory text.\n\nStable\n\nStable details.",
    }]);
  });

  test("splits large sections, assigns stable consecutive ids, and paginates by section", () => {
    const document = createNormalizedDocument("Large", "https://example.com/", [
      `Large\n\n${"first ".repeat(1_000)}\n\n${"second ".repeat(1_000)}`,
    ]);
    assert.ok(document.sections.length > 1);
    assert.deepStrictEqual(document.sections.map((section) => section.id), document.sections.map((_section, index) => index + 1));
    const first = selectDocumentContent(document, 0, undefined, 4_500);
    assert.ok(first.sections.length >= 1);
    assert.ok(first.nextCursor);
    const next = selectDocumentContent(document, first.nextCursor);
    assert.strictEqual(next.sections[0]?.id, first.sections.at(-1)!.id + 1);
  });

  test("selects matching whole sections without renumbering", () => {
    const document = createNormalizedDocument("Releases", "https://example.com/releases", [
      "Alpha\n\nOld information.",
      "Stable\n\nVersion 10 release details.",
      "Preview\n\nVersion 11 details.",
    ]);
    const focused = selectDocumentContent(document, 0, "Version 10", 2_000);
    assert.deepStrictEqual(focused.sections, [{ id: 2, content: "Stable\n\nVersion 10 release details." }]);
  });
});

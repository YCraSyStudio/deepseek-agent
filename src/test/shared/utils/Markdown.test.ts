import assert from "node:assert/strict";
import { normalizeAssistantMarkdown as normalize } from "@/shared/utils/Markdown";

suite("assistant Markdown normalization", () => {
  test("unwraps supported response envelopes while retaining unknown markup and limiting nesting", () => {
    assert.equal(normalize(' <response role="answer"><FINAL><answer> Done </answer></FINAL></response> '), "Done");
    assert.equal(normalize("<widget>Keep this</widget>"), "<widget>Keep this</widget>");
    assert.equal(normalize("<answer><response><final><content>Text</content></final></response></answer>"), "<content>Text</content>");
  });
  test("unescapes Markdown syntax outside fenced code without changing fenced text", () => {
    const code = "```ts\n\\*literal\\*\nA|B\nC|D\n```";
    assert.equal(normalize(`\\*bold\\*\\n\n${code}\n\\# heading`), `*bold*\\n\n${code}\n# heading`);
  });
  test("inserts a missing table separator and normalizes cell whitespace", () => {
    assert.equal(normalize("Name | Value\n A | 1 \n B | 2"), "| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |");
  });
  test("normalizes explicit separators and suppresses repeated separators in one table", () => {
    assert.equal(normalize("A|B\n:---|---:\nC|D\n---|---\nE|F"), "| A | B |\n| --- | --- |\n| C | D |\n| E | F |");
    assert.equal(normalize("---|---"), "");
  });
  test("a blank line ends a table so the following table receives its own separator", () => {
    assert.equal(normalize("A|B\nC|D\n\nX|Y\nZ|W"), "| A | B |\n| --- | --- |\n| C | D |\n\n| X | Y |\n| --- | --- |\n| Z | W |");
  });
  for (const next of ["# Heading | value", "- List | item", "1. Ordered | item"]) {
    test(`does not mistake a following Markdown block for a table row: ${next}`, () => {
      assert.equal(normalize(`One | Two\n${next}`), `One | Two\n${next}`);
    });
  }
  test("preserves ordinary text and a standalone pipe-delimited line", () => {
    assert.equal(normalize("  Ordinary text  "), "Ordinary text");
    assert.equal(normalize("One | Two"), "One | Two"); assert.equal(normalize(""), "");
  });
});

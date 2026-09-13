import * as assert from "node:assert";
import { reconstructDiffDocuments } from "@/vscode/editor/diff/UnifiedDiffDocuments";

suite("unified diff documents", () => {
  test("reconstructs before and after excerpts for one change", () => {
    const documents = reconstructDiffDocuments([
      "--- a/src/App.ts",
      "+++ b/src/App.ts",
      "@@ -1,3 +1,3 @@",
      " const first = 1;",
      "-const value = 'old';",
      "+const value = 'new';",
      " export default value;",
    ].join("\n"));

    assert.deepStrictEqual(documents, {
      before: "const first = 1;\nconst value = 'old';\nexport default value;",
      after: "const first = 1;\nconst value = 'new';\nexport default value;",
    });
  });

  test("keeps separate hunks aligned", () => {
    const documents = reconstructDiffDocuments([
      "--- a/src/App.ts",
      "+++ b/src/App.ts",
      "@@ -1,1 +1,1 @@",
      "-first",
      "+changed first",
      "@@ -20,1 +20,1 @@",
      "-last",
      "+changed last",
    ].join("\n"));

    assert.deepStrictEqual(documents, {
      before: "first\n\n\n\nlast",
      after: "changed first\n\n\n\nchanged last",
    });
  });

  test("rejects truncated and malformed diffs", () => {
    assert.strictEqual(reconstructDiffDocuments("--- a/file\n+++ b/file\n... diff truncated (4 more lines not shown)"), null);
    assert.strictEqual(reconstructDiffDocuments("--- a/file\n+++ b/file\n@@ -1,2 +1,1 @@\n-old\n+new"), null);
    assert.strictEqual(reconstructDiffDocuments("not a diff"), null);
  });
});

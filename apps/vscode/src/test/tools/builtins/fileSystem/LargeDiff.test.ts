import assert from "node:assert/strict";
import { createUnifiedDiff } from "@/infrastructure/tools/builtins/fileSystem/StructuredResult";

suite("large file diff preview", () => {
  test("retains full change counts when the bounded linear diff omits most of its display", () => {
    const before = Array.from({ length: 1100 }, (_, i) => `old line ${i}`).join("\n");
    const after = Array.from({ length: 1100 }, (_, i) => `new line ${i}`).join("\n");
    const result = createUnifiedDiff({ filePath: "large.txt", before, after });
    assert.deepEqual(result.stats, { additions: 1100, deletions: 1100 }); assert.equal(result.truncated, true);
    assert.match(result.content, /--- a\/large\.txt/); assert.match(result.content, /@@ -1,1100 \+1,1100 @@/);
    assert.match(result.content, /diff truncated/); assert.ok(result.content.split("\n").length <= 241);
  });
});

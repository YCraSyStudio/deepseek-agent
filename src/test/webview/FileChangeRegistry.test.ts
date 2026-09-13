import * as assert from "node:assert";
import { createHash } from "node:crypto";
import { FileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";

const OPTIONS = { maxEntries: 2, maxDocumentBytes: 1024 };

suite("file change registry", () => {
  test("records the written contents and finds them by document hash", () => {
    const registry = new FileChangeRegistry(OPTIONS);
    const change = registry.record("src/App.ts", Buffer.from("old"), Buffer.from("new"));

    assert.ok(change);
    assert.strictEqual(change.before, "old");
    assert.strictEqual(change.after, "new");
    assert.strictEqual(change.beforeHash, hash("old"));
    assert.strictEqual(change.afterHash, hash("new"));
    assert.deepStrictEqual(registry.find("src/App.ts", hash("old"), hash("new")), change);
  });

  test("matches recorded files through workspace aliases but requires the exact change", () => {
    const registry = new FileChangeRegistry(OPTIONS);
    registry.record("app/src/App.ts", undefined, Buffer.from("new"));

    assert.strictEqual(registry.find("src/App.ts", undefined, hash("new"))?.after, "new");
    assert.strictEqual(registry.find("src/App.ts", undefined, hash("older")), undefined);
    assert.strictEqual(registry.find("src/Other.ts", undefined, hash("new")), undefined);
  });

  test("ignores binary and oversized documents", () => {
    const registry = new FileChangeRegistry(OPTIONS);
    assert.strictEqual(registry.record("image.png", undefined, Buffer.from([0, 1, 2, 3])), undefined);
    assert.strictEqual(registry.record("big.txt", undefined, Buffer.alloc(OPTIONS.maxDocumentBytes + 1, 65)), undefined);
    assert.strictEqual(registry.size, 0);
  });

  test("keeps the most recent changes only", () => {
    const registry = new FileChangeRegistry(OPTIONS);
    registry.record("a.ts", undefined, Buffer.from("a"));
    registry.record("b.ts", undefined, Buffer.from("b"));
    registry.record("c.ts", undefined, Buffer.from("c"));

    assert.strictEqual(registry.size, 2);
    assert.strictEqual(registry.find("a.ts", undefined, hash("a")), undefined);
    assert.strictEqual(registry.find("c.ts", undefined, hash("c"))?.after, "c");
  });
});

function hash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

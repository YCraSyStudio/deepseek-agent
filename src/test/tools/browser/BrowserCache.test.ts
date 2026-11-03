import assert from "node:assert/strict";
import { LruCache } from "@/infrastructure/browser/BrowserCache";

suite("browser cache retention", () => {
  test("evicts the least recently used content and accounts for replacements by size", () => {
    const cache = new LruCache<string, string>(2, 5);
    cache.set("first", "First", 2); cache.set("second", "Second", 2);
    assert.equal(cache.size, 2); assert.equal(cache.get("first"), "First");
    cache.set("third", "Third", 2);
    assert.equal(cache.size, 2); assert.equal(cache.get("second"), undefined);
    assert.deepEqual(cache.valuesNewestFirst(), ["Third", "First"]);
    cache.set("first", "Expanded", 5);
    assert.equal(cache.size, 1); assert.equal(cache.get("third"), undefined);
    cache.set("first", "Reduced", 1); cache.set("new", "New", 4);
    assert.equal(cache.size, 2); assert.deepEqual(cache.valuesNewestFirst(), ["New", "Reduced"]);
    assert.equal(cache.delete("first"), true); assert.equal(cache.delete("first"), false); assert.equal(cache.size, 1);
  });
  test("removes expired entries during reads and listing without discarding non-expiring entries", () => {
    const cache = new LruCache<string, string>(4);
    cache.set("expired-read", "Expired", 1, 0); cache.set("expired-list", "Expired", 1, 0);
    cache.set("retained", "Retained");
    const later = Date.now() + 1000;
    assert.equal(cache.get("expired-read", later), undefined); assert.equal(cache.size, 2);
    assert.deepEqual(cache.valuesNewestFirst(later), ["Retained"]); assert.equal(cache.size, 1);
    assert.equal(cache.get("retained", later), "Retained");
  });
});

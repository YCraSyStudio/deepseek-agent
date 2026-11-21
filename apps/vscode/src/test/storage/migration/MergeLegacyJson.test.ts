import assert from "node:assert/strict";
import { mergeLegacyJson } from "@/infrastructure/persistence/MergeLegacyJson";

suite("legacy JSON merge", () => {
  test("combines complementary nested fields and fills empty values", () => {
    const merged = mergeLegacyJson({ settings: { language: "es", theme: "" }, history: [] },
      { settings: { theme: "dark" }, history: ["chat"] });
    assert.deepEqual(merged.value, { settings: { language: "es", theme: "dark" }, history: ["chat"] });
    assert.deepEqual(merged.conflicts, []);
  });

  test("prefers the more complete original for contradictory values and records their paths", () => {
    const merged = mergeLegacyJson({ historyEnabled: true, language: "es", model: "deepseek-flash" }, { historyEnabled: false });
    assert.deepEqual(merged.value, { historyEnabled: true, language: "es", model: "deepseek-flash" });
    assert.deepEqual(merged.conflicts, ["$.historyEnabled"]);
  });

  test("merges messages by identity without duplicating shared messages", () => {
    const merged = mergeLegacyJson({ messages: [{ id: "first", content: "hello", attachments: ["image"] }] },
      { messages: [{ id: "first", content: "hello", timestamp: 1 }, { id: "second", content: "reply" }] });
    assert.deepEqual(merged.value, { messages: [
      { id: "first", content: "hello", attachments: ["image"], timestamp: 1 },
      { id: "second", content: "reply" },
    ] });
    assert.deepEqual(merged.conflicts, []);
  });

  test("keeps incompatible identities as one complete version rather than inventing a conversation", () => {
    const merged = mergeLegacyJson({ id: "old", title: "old conversation" }, { id: "new" });
    assert.deepEqual(merged.value, { id: "old", title: "old conversation" });
    assert.deepEqual(merged.conflicts, ["$.id"]);
  });
});

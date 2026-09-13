import * as assert from "node:assert";
import { resolveAuxiliaryModel } from "@/application/chat/AuxiliaryModelPolicy";

suite("auxiliary model policy", () => {
  test("retains models without verified substitution compatibility", () => {
    assert.strictEqual(resolveAuxiliaryModel({ model: "deepseek-flash", baseUrl: "https://api.deepseek.com" }), "deepseek-flash");
    assert.strictEqual(resolveAuxiliaryModel({ model: "future-model", baseUrl: "https://api.deepseek.com" }), "future-model");
    assert.strictEqual(resolveAuxiliaryModel({ model: "custom", baseUrl: "https://example.com" }), "custom");
    assert.strictEqual(resolveAuxiliaryModel({ model: "custom", baseUrl: "https://api.deepseek.com.example.com" }), "custom");
  });
});

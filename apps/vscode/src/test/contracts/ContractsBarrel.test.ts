import assert from "node:assert/strict";
import * as contracts from "@/contracts";
import { DEFAULT_CONFIG, isReasoningEffort, mapReasoningEffort, normalizeReasoningEffort } from "@/contracts";

suite("contracts barrel", () => {
  test("exposes the runtime configuration and protocol values", () => {
    assert.equal(contracts.DEEPSEEK_FLASH_MODEL_ID, "deepseek-flash");
    assert.equal(contracts.DEEPSEEK_PRO_MODEL_ID, "deepseek-v4-pro");
    assert.equal(typeof contracts.MAX_OUTPUT_TOKENS, "number");
    assert.ok(contracts.MODEL_REGISTRY.length > 0);
    assert.equal(contracts.WEBVIEW_PROTOCOL_VERSION, 5);
    assert.ok(Object.keys(contracts.WEBVIEW_INPUT_LIMITS).length > 0);
    assert.equal(DEFAULT_CONFIG.permissionMode, "default");
    assert.deepEqual(contracts.REASONING_EFFORT_VALUES.includes("high"), true);
    assert.equal(isReasoningEffort("high"), true);
    assert.equal(isReasoningEffort("unknown"), false);
    assert.equal(mapReasoningEffort("high"), "high");
    assert.equal(normalizeReasoningEffort("unexpected"), contracts.DEFAULT_REASONING_EFFORT);
  });
});

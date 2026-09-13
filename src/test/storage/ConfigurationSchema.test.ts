import * as assert from "assert";
import { DEFAULT_CONFIG, type AppConfig } from "@/contracts";
import {
  isStoredSettingKey,
  normalizeConfig,
  normalizeSettingValue,
  toStoredSettings,
  type StoredSettingKey,
} from "@/application/settings/ConfigurationSchema";

suite("configuration schema", () => {
  test("keeps the stored inventory in sync with AppConfig", () => {
    const config = normalizeConfig({});
    const stored = toStoredSettings(config);
    const expected = (Object.keys(config) as Array<keyof AppConfig>)
      .filter((key): key is StoredSettingKey => key !== "apiKey" && key !== "userId");

    assert.deepStrictEqual(Object.keys(stored).sort(), [...expected].sort());
    for (const key of expected) {
      assert.ok(isStoredSettingKey(key), `${key} is missing from the stored settings inventory`);
      assert.deepStrictEqual(normalizeSettingValue(key, stored[key]), stored[key], `${key} does not round-trip through its normalizer`);
    }
  });

  test("preserves every reasoning effort the picker offers", () => {
    for (const effort of ["low", "high", "max"] as const) {
      assert.strictEqual(normalizeSettingValue("reasoningEffort", effort), effort);
      assert.strictEqual(normalizeConfig({ reasoningEffort: effort }).reasoningEffort, effort);
    }
  });

  test("falls back to the default effort for unsupported values", () => {
    assert.strictEqual(normalizeSettingValue("reasoningEffort", "minimal"), DEFAULT_CONFIG.reasoningEffort);
    assert.strictEqual(normalizeSettingValue("reasoningEffort", "xhigh"), DEFAULT_CONFIG.reasoningEffort);
    assert.strictEqual(normalizeSettingValue("reasoningEffort", 7), DEFAULT_CONFIG.reasoningEffort);
    assert.strictEqual(normalizeSettingValue("reasoningEffort", undefined), DEFAULT_CONFIG.reasoningEffort);
  });
});

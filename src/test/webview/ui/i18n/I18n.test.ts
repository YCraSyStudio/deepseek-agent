import * as assert from "assert";
import { detectUiLocale, getUiLocale, setInterfaceLanguage, subscribeUiLocale } from "@/ui/i18n/I18n";
import { en } from "@/ui/i18n/locales/en";
import { es } from "@/ui/i18n/locales/es";
import { zh } from "@/ui/i18n/locales/zh";
import type { TranslationCatalog } from "@/ui/i18n/locales/Types";

suite("webview internationalization", () => {
  test("detects supported locales and falls back to English", () => {
    assert.strictEqual(detectUiLocale("es-ES"), "es");
    assert.strictEqual(detectUiLocale("zh-CN"), "zh");
    assert.strictEqual(detectUiLocale("fr-FR"), "en");
  });

  test("keeps translated catalogs aligned", () => {
    const flatEn = flattenCatalog(en);
    const flatEs = flattenCatalog(es);
    const flatZh = flattenCatalog(zh);
    assert.deepStrictEqual(Object.keys(flatEs).sort(), Object.keys(flatEn).sort());
    assert.deepStrictEqual(Object.keys(flatZh).sort(), Object.keys(flatEs).sort());
    for (const [key, translation] of Object.entries(flatEs)) {
      assert.deepStrictEqual(placeholders(translation), placeholders(flatEn[key]), `Spanish placeholders differ for: ${key}`);
    }
    for (const [key, translation] of Object.entries(flatZh)) {
      assert.deepStrictEqual(placeholders(translation), placeholders(flatEn[key]), `Chinese placeholders differ for: ${key}`);
    }
  });

  test("changes the selected interface language and notifies subscribers", () => {
    setInterfaceLanguage("en");
    let notifications = 0;
    const unsubscribe = subscribeUiLocale(() => {notifications += 1;});

    setInterfaceLanguage("es");
    assert.strictEqual(getUiLocale(), "es");
    assert.strictEqual(notifications, 1);

    unsubscribe();
    setInterfaceLanguage("en");
    assert.strictEqual(notifications, 1);
  });
});

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((match) => match[1]).sort();
}

function flattenCatalog(catalog: TranslationCatalog, prefix = "", result: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {result[path] = value;}
    else {flattenCatalog(value, path, result);}
  }
  return result;
}

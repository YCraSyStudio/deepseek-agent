import type { InterfaceLanguage } from "@/contracts";
import { en } from "./locales/en";
import { localeCatalogs } from "./locales";
import type { TranslationCatalog, TranslationKey as CatalogKey } from "./locales/Types";

export type UiLocale = keyof typeof localeCatalogs;

type Values = Record<string, string | number>;
export type TranslationKey = CatalogKey<typeof en>;

const localeListeners = new Set<() => void>();

let uiLocale: UiLocale = detectUiLocale(getSystemLanguage());

export function t(source: TranslationKey, values: Values = {}): string {
  return translateForLocale(uiLocale, source, values);
}

function translateForLocale(locale: UiLocale, source: string, values: Values = {}): string {
  const template = findTranslation(localeCatalogs[locale], source) ?? findTranslation(localeCatalogs.en, source) ?? source;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

function findTranslation(catalog: TranslationCatalog, key: string): string | undefined {
  const direct = catalog[key];
  if (typeof direct === "string") {return direct;}
  let current: string | TranslationCatalog | undefined = catalog;
  for (const segment of key.split(".")) {
    if (typeof current === "string") {return undefined;}
    current = current[segment];
    if (current === undefined) {return undefined;}
  }
  return typeof current === "string" ? current : undefined;
}

export function formatUiDate(value: Date): string {
  return new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export function getUiLocale(): UiLocale {
  return uiLocale;
}

export function setInterfaceLanguage(language: InterfaceLanguage): void {
  const nextLocale = language === "auto" ? detectUiLocale(getSystemLanguage()) : language;
  if (typeof document !== "undefined") {document.documentElement.lang = nextLocale;}
  if (nextLocale === uiLocale) {return;}
  uiLocale = nextLocale;
  localeListeners.forEach((listener) => listener());
}

export function subscribeUiLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function detectUiLocale(value: string): UiLocale {
  const language = value.toLowerCase();
  if (language.startsWith("es")) {return "es";}
  if (language.startsWith("zh")) {return "zh";}
  return "en";
}

function getSystemLanguage(): string {
  return typeof navigator === "undefined" ? "en" : navigator.language;
}

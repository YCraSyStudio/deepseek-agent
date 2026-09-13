import {
  DEFAULT_CONFIG,
  MAX_OUTPUT_TOKENS,
  normalizeReasoningEffort,
  type AppConfig,
  type InterfaceLanguage,
  type PermissionMode,
  type SearxngEngineOption,
} from "@/contracts";
import { normalizeApiBaseUrlOrDefault } from "@/shared/security/ApiOrigin";
import { normalizeUsageCurrency } from "@/shared/usage/UsageCurrency";
import { isRecord } from "@/shared/utils/TypeGuards";

export type StoredSettingKey = Exclude<keyof AppConfig, "apiKey" | "userId">;
export type StoredSettings = Pick<AppConfig, StoredSettingKey>;

const SETTING_KEYS: readonly StoredSettingKey[] = [
  "interfaceLanguage", "baseUrl", "model", "thinkingMode", "reasoningEffort",
  "temperature", "topP", "maxTokens", "maxConcurrentGenerations",
  "permissionMode", "autoContext", "historyEnabled",
  "historyRetentionDays", "includeHomeAgents", "usageBreakdown", "usageCostCurrency", "webSearchEnabled", "webSearchEngine", "searxngUrl", "searxngEngines", "searxngEngineCatalog",
];

const STORED_SETTING_KEYS: ReadonlySet<StoredSettingKey> = new Set(SETTING_KEYS);

/** Every setting the extension persists, in storage order. Additions belong here and in the UI only. */
export const SETTING_KEYS_LIST = SETTING_KEYS;

export function normalizeConfig(value: unknown): AppConfig {
  const config = isRecord(value) ? value : {};
  return {
    interfaceLanguage: normalizeInterfaceLanguage(config.interfaceLanguage),
    apiKey: "",
    baseUrl: normalizeApiBaseUrlOrDefault(config.baseUrl, DEFAULT_CONFIG.baseUrl),
    model: normalizeNonEmptyString(config.model, DEFAULT_CONFIG.model),
    thinkingMode: normalizeBoolean(config.thinkingMode, DEFAULT_CONFIG.thinkingMode),
    reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
    temperature: clampNumber(config.temperature, 0, 2, DEFAULT_CONFIG.temperature),
    topP: clampNumber(config.topP, 0, 1, DEFAULT_CONFIG.topP),
    maxTokens: clampInteger(config.maxTokens, 1, MAX_OUTPUT_TOKENS, DEFAULT_CONFIG.maxTokens),
    maxConcurrentGenerations: clampInteger(config.maxConcurrentGenerations, 1, 16, DEFAULT_CONFIG.maxConcurrentGenerations),
    permissionMode: normalizePermissionMode(config.permissionMode),
    autoContext: normalizeBoolean(config.autoContext, DEFAULT_CONFIG.autoContext),
    historyEnabled: normalizeBoolean(config.historyEnabled, DEFAULT_CONFIG.historyEnabled),
    historyRetentionDays: clampInteger(config.historyRetentionDays, 0, 3650, DEFAULT_CONFIG.historyRetentionDays),
    includeHomeAgents: normalizeBoolean(config.includeHomeAgents, DEFAULT_CONFIG.includeHomeAgents),
    usageBreakdown: normalizeBoolean(config.usageBreakdown, DEFAULT_CONFIG.usageBreakdown),
    usageCostCurrency: normalizeUsageCurrency(config.usageCostCurrency),
    webSearchEnabled: normalizeBoolean(config.webSearchEnabled, DEFAULT_CONFIG.webSearchEnabled),
    webSearchEngine: "searxng",
    searxngUrl: normalizeSearxngUrl(config.searxngUrl),
    searxngEngines: normalizeSearxngEngines(config.searxngEngines),
    searxngEngineCatalog: normalizeSearxngEngineCatalog(config.searxngEngineCatalog),
  };
}

export function toStoredSettings(config: AppConfig): StoredSettings {
  const stored = {} as StoredSettings;
  for (const key of STORED_SETTING_KEYS) {
    Object.assign(stored, { [key]: config[key] });
  }
  return stored;
}

export function isStoredSettingKey(key: string): key is StoredSettingKey {
  return STORED_SETTING_KEYS.has(key as StoredSettingKey);
}

export function normalizeSettingValue(key: StoredSettingKey, value: unknown): unknown {
  if (key === "interfaceLanguage") {return normalizeInterfaceLanguage(value);}
  if (key === "permissionMode") {return normalizePermissionMode(value);}
  if (key === "reasoningEffort") {return normalizeReasoningEffort(value);}
  if (key === "usageCostCurrency") {return normalizeUsageCurrency(value);}
  if (["thinkingMode", "autoContext", "historyEnabled", "includeHomeAgents", "usageBreakdown", "webSearchEnabled"].includes(key)) {
    return normalizeBoolean(value, DEFAULT_CONFIG[key] as boolean);
  }
  if (key === "model") {return normalizeNonEmptyString(value, DEFAULT_CONFIG.model);}
  if (key === "baseUrl") {return normalizeApiBaseUrlOrDefault(value, DEFAULT_CONFIG.baseUrl);}
  if (key === "temperature") {return clampNumber(value, 0, 2, DEFAULT_CONFIG.temperature);}
  if (key === "topP") {return clampNumber(value, 0, 1, DEFAULT_CONFIG.topP);}
  if (key === "maxTokens") {return clampInteger(value, 1, MAX_OUTPUT_TOKENS, DEFAULT_CONFIG.maxTokens);}
  if (key === "maxConcurrentGenerations") {return clampInteger(value, 1, 16, DEFAULT_CONFIG.maxConcurrentGenerations);}
  if (key === "historyRetentionDays") {return clampInteger(value, 0, 3650, DEFAULT_CONFIG.historyRetentionDays);}
  if (key === "webSearchEngine") {return "searxng";}
  if (key === "searxngUrl") {return normalizeSearxngUrl(value);}
  if (key === "searxngEngines") {return normalizeSearxngEngines(value);}
  if (key === "searxngEngineCatalog") {return normalizeSearxngEngineCatalog(value);}
  return value;
}

function normalizeInterfaceLanguage(value: unknown): InterfaceLanguage {
  return value === "auto" || value === "en" || value === "es" || value === "zh" ? value : DEFAULT_CONFIG.interfaceLanguage;
}

function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === "approve-for-me") {return "auto-approve";}
  if (value === "workspace") {return "full-access";}
  if (value === "chat" || value === "enabled" || value === "read-only" || value === "custom") {return "default";}
  return value === "default" || value === "full-access" || value === "auto-approve"
    ? value
    : DEFAULT_CONFIG.permissionMode;
}

function normalizeSearxngUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {return DEFAULT_CONFIG.searxngUrl;}
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) {return DEFAULT_CONFIG.searxngUrl;}
    const hostname = url.hostname.toLowerCase();
    const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {return DEFAULT_CONFIG.searxngUrl;}
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {return DEFAULT_CONFIG.searxngUrl;}
}

function normalizeSearxngEngines(value: unknown): string[] {
  if (!Array.isArray(value)) {return DEFAULT_CONFIG.searxngEngines;}
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {continue;}
    const shortcut = item.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(shortcut)) {continue;}
    seen.add(shortcut);
    if (seen.size >= 512) {break;}
  }
  return [...seen];
}

function normalizeSearxngEngineCatalog(value: unknown): SearxngEngineOption[] {
  if (!Array.isArray(value)) {return DEFAULT_CONFIG.searxngEngineCatalog;}
  const seen = new Set<string>();
  const engines: SearxngEngineOption[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.shortcut !== "string") {continue;}
    const shortcut = item.shortcut.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(shortcut) || seen.has(shortcut)) {continue;}
    seen.add(shortcut);
    engines.push({
      name: item.name.trim().slice(0, 256) || shortcut,
      shortcut,
      categories: Array.isArray(item.categories)
        ? item.categories.filter((category): category is string => typeof category === "string").map((category) => category.slice(0, 128)).slice(0, 16)
        : [],
      enabled: item.enabled === true,
    });
    if (engines.length >= 512) {break;}
  }
  return engines;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

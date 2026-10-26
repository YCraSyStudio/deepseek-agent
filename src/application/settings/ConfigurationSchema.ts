import {
  DEFAULT_CONFIG,
  MAX_OUTPUT_TOKENS,
  normalizeReasoningEffort,
  type AppConfig,
  type InterfaceLanguage,
  type PermissionMode,
} from "@/contracts";
import { normalizeApiBaseUrlOrDefault } from "@/shared/security/ApiOrigin";
import { normalizeUsageCurrency } from "@/shared/usage/UsageCurrency";
import { isRecord } from "@/shared/utils/TypeGuards";

export type StoredSettingKey = Exclude<keyof AppConfig, "apiKey" | "userId">;
export type StoredSettings = Pick<AppConfig, StoredSettingKey>;

const SETTING_KEYS: readonly StoredSettingKey[] = [
  "interfaceLanguage", "baseUrl", "model", "thinkingMode", "reasoningEffort",
  "temperature", "topP", "maxTokens", "maxConcurrentGenerations",
  "permissionMode", "historyEnabled",
  "historyRetentionDays", "snapshotStorageLimitMb", "includeHomeAgents", "usageBreakdown", "usageCostCurrency", "automaticCaptureEnabled", "automaticCaptureLimit", "browserAccess", "webSearchEnabled", "webSearchRegion", "privacyMinimizeData", "betaFeaturesEnabled", "editorSuggestionsEnabled", "chatSuggestionsEnabled",
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
    historyEnabled: normalizeBoolean(config.historyEnabled, DEFAULT_CONFIG.historyEnabled),
    historyRetentionDays: clampInteger(config.historyRetentionDays, 0, 3650, DEFAULT_CONFIG.historyRetentionDays),
    snapshotStorageLimitMb: clampInteger(config.snapshotStorageLimitMb, 64, 65536, DEFAULT_CONFIG.snapshotStorageLimitMb),
    includeHomeAgents: normalizeBoolean(config.includeHomeAgents, DEFAULT_CONFIG.includeHomeAgents),
    usageBreakdown: normalizeBoolean(config.usageBreakdown, DEFAULT_CONFIG.usageBreakdown),
    usageCostCurrency: normalizeUsageCurrency(config.usageCostCurrency),
    automaticCaptureEnabled: normalizeBoolean(config.automaticCaptureEnabled, false),
    automaticCaptureLimit: clampInteger(config.automaticCaptureLimit, 1, 40, 10),
    browserAccess: config.browserAccess === "always" || config.browserAccess === "never" ? config.browserAccess : "ask",
    webSearchEnabled: normalizeBoolean(config.webSearchEnabled, DEFAULT_CONFIG.webSearchEnabled),
    webSearchRegion: normalizeSearchRegion(config.webSearchRegion),
    privacyMinimizeData: normalizeBoolean(config.privacyMinimizeData, DEFAULT_CONFIG.privacyMinimizeData),
    betaFeaturesEnabled: normalizeBoolean(config.betaFeaturesEnabled, DEFAULT_CONFIG.betaFeaturesEnabled),
    editorSuggestionsEnabled: normalizeBoolean(config.editorSuggestionsEnabled, DEFAULT_CONFIG.editorSuggestionsEnabled),
    chatSuggestionsEnabled: normalizeBoolean(config.chatSuggestionsEnabled, DEFAULT_CONFIG.chatSuggestionsEnabled),
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
  if (key === "webSearchRegion") {return normalizeSearchRegion(value);}
  if (key === "automaticCaptureEnabled") {return normalizeBoolean(value, false);}
  if (key === "automaticCaptureLimit") {return clampInteger(value, 1, 40, 10);}
  if (key === "browserAccess") {return value === "always" || value === "never" ? value : "ask";}
  if (key === "interfaceLanguage") {return normalizeInterfaceLanguage(value);}
  if (key === "permissionMode") {return normalizePermissionMode(value);}
  if (key === "reasoningEffort") {return normalizeReasoningEffort(value);}
  if (key === "usageCostCurrency") {return normalizeUsageCurrency(value);}
  if (["thinkingMode", "historyEnabled", "includeHomeAgents", "usageBreakdown", "webSearchEnabled", "privacyMinimizeData", "betaFeaturesEnabled", "editorSuggestionsEnabled", "chatSuggestionsEnabled"].includes(key)) {
    return normalizeBoolean(value, DEFAULT_CONFIG[key] as boolean);
  }
  if (key === "model") {return normalizeNonEmptyString(value, DEFAULT_CONFIG.model);}
  if (key === "baseUrl") {return normalizeApiBaseUrlOrDefault(value, DEFAULT_CONFIG.baseUrl);}
  if (key === "temperature") {return clampNumber(value, 0, 2, DEFAULT_CONFIG.temperature);}
  if (key === "topP") {return clampNumber(value, 0, 1, DEFAULT_CONFIG.topP);}
  if (key === "maxTokens") {return clampInteger(value, 1, MAX_OUTPUT_TOKENS, DEFAULT_CONFIG.maxTokens);}
  if (key === "maxConcurrentGenerations") {return clampInteger(value, 1, 16, DEFAULT_CONFIG.maxConcurrentGenerations);}
  if (key === "historyRetentionDays") {return clampInteger(value, 0, 3650, DEFAULT_CONFIG.historyRetentionDays);}
  if (key === "snapshotStorageLimitMb") {return clampInteger(value, 64, 65536, DEFAULT_CONFIG.snapshotStorageLimitMb);}
  return value;
}

function normalizeSearchRegion(value: unknown): string {
  return typeof value === "string" && /^(?:auto|global|[A-Za-z]{2})$/.test(value.trim())
    ? (/^(auto|global)$/.test(value.trim()) ? value.trim() : value.trim().toUpperCase()) : "global";
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

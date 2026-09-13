import { DEFAULT_USAGE_CURRENCY, type UsageCurrency } from "@/shared/usage/UsageCurrency";
import { DEEPSEEK_FLASH_MODEL_ID, MAX_OUTPUT_TOKENS } from "./deepseek/Models";

export type PermissionMode = "default" | "auto-approve" | "full-access";
export type InterfaceLanguage = "auto" | "en" | "es" | "zh";

export const REASONING_EFFORT_VALUES = ["low", "high", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORT_VALUES as readonly string[]).includes(value);
}

export function normalizeReasoningEffort(value: unknown, fallback: ReasoningEffort = DEFAULT_REASONING_EFFORT): ReasoningEffort {
  return isReasoningEffort(value) ? value : fallback;
}

/** Maps the picker vocabulary (including legacy aliases) to a supported effort level. */
export function mapReasoningEffort(reasoning: string | undefined): ReasoningEffort | undefined {
  if (!reasoning || reasoning === "off") {return undefined;}
  if (reasoning === "low" || reasoning === "minimal") {return "low";}
  if (reasoning === "medium" || reasoning === "xhigh") {return "high";}
  return reasoning === "max" ? "max" : "high";
}

export interface SearxngEngineOption {
  name: string;
  shortcut: string;
  categories: string[];
  enabled: boolean;
}

export interface AppConfig {
  interfaceLanguage: InterfaceLanguage;
  apiKey: string;
  baseUrl: string;

  model: string;

  thinkingMode: boolean;
  reasoningEffort?: ReasoningEffort;

  temperature: number;
  topP: number;

  maxTokens: number;
  maxConcurrentGenerations: number;
  permissionMode: PermissionMode;

  autoContext: boolean;
  historyEnabled: boolean;
  historyRetentionDays: number;
  includeHomeAgents: boolean;
  usageBreakdown: boolean;
  usageCostCurrency: UsageCurrency;
  webSearchEnabled: boolean;
  webSearchEngine: "searxng";
  searxngUrl: string;
  searxngEngines: string[];
  searxngEngineCatalog: SearxngEngineOption[];

  userId?: string;
}

export interface PermissionSnapshot {
  revision: number;
  permissionMode: PermissionMode;
  workspaceTrusted: boolean;
  fingerprint: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  interfaceLanguage: "auto",
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: DEEPSEEK_FLASH_MODEL_ID,
  thinkingMode: true,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  temperature: 1.0,
  topP: 1.0,
  maxTokens: MAX_OUTPUT_TOKENS,
  maxConcurrentGenerations: 8,
  permissionMode: "default",
  autoContext: false,
  historyEnabled: true,
  historyRetentionDays: 30,
  includeHomeAgents: false,
  usageBreakdown: false,
  usageCostCurrency: DEFAULT_USAGE_CURRENCY,
  webSearchEnabled: true,
  webSearchEngine: "searxng",
  searxngUrl: "http://127.0.0.1:8888",
  searxngEngines: [],
  searxngEngineCatalog: [],
};

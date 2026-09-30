import type {
  ApiCredentialState,
  SaveOnBlurFn,
  SettingsConfig,
  UpdateConfigFn,
} from "./SettingsTypes";
import type { TranslationKey } from "@webview/i18n/I18n";
import type { ReactNode } from "react";

export type ApiSectionProps = {
  config: Pick<SettingsConfig, "model" | "baseUrl" | "thinkingMode" | "reasoningEffort">;
  apiKeyDraft: string;
  credential: ApiCredentialState | null;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
  onApiKeyChange: (value: string) => void;
  onApiKeyBlur: (value: string) => void;
  modelOptions: Array<{ value: string; label: string }>;
  reasoningEffortOptions: ReadonlyArray<{ value: NonNullable<SettingsConfig["reasoningEffort"]>; label: TranslationKey }>;
  children?: ReactNode;
};

export type AdvancedSectionProps = {
  config: Pick<SettingsConfig, "temperature" | "topP" | "maxTokens" | "maxConcurrentGenerations" | "baseUrl" | "thinkingMode">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
};

export type GeneralSectionProps = {
  config: Pick<SettingsConfig, "interfaceLanguage" | "historyEnabled" | "historyRetentionDays" | "includeHomeAgents" | "usageBreakdown" | "usageCostCurrency">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
};

export type ToolsSectionProps = {
  config: Pick<SettingsConfig, "permissionMode" | "webSearchEnabled" | "searxngUrl" | "searxngEngines" | "searxngFallbackEngines" | "searxngEngineCatalog">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
  permissionUpdatePending?: boolean;
};

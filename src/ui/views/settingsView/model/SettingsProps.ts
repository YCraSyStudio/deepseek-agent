import type {
  ApiCredentialState,
  SaveOnBlurFn,
  SettingsConfig,
  UpdateConfigFn,
} from "./SettingsTypes";
import type { TranslationKey } from "@webview/i18n/I18n";
import type { ReactNode } from "react";
import type { AvailableToolInfo } from "@/contracts";

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
  config: Pick<SettingsConfig, "temperature" | "topP" | "maxTokens" | "baseUrl" | "thinkingMode">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
};

export type GeneralSectionProps = {
  children?: ReactNode;
  config: Pick<SettingsConfig, "interfaceLanguage" | "maxConcurrentGenerations" | "historyEnabled" | "historyRetentionDays" | "snapshotStorageLimitMb" | "privacyMinimizeData" | "usageBreakdown" | "usageCostCurrency">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
};

export type ToolsSectionProps = {
  config: Pick<SettingsConfig, "permissionMode" | "webSearchEnabled" | "webSearchRegion" | "browserAccess" | "automaticCaptureEnabled" | "automaticCaptureLimit">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
  permissionUpdatePending?: boolean;
  availableTools: AvailableToolInfo[] | null;
};

export type CustomizationSectionProps = {
  workspaceRoots: import("@/contracts/Customization").WorkspaceInstructionsRoot[] | null;
  workspaceRootUri: string;
  onWorkspaceRootChange: (uri: string) => void;
  onOpenWorkspaceAgents: () => void;
  workspacePending: boolean;
  workspaceError?: string;
  config: Pick<SettingsConfig, "includeHomeAgents">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
  onOpenGlobalAgents: () => void;
  pending: boolean;
};

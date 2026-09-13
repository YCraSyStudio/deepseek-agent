import * as vscode from "vscode";
import type { AppConfig } from "@/contracts";
import { CONFIG_SECTION, INCLUDE_HOME_AGENTS_KEY } from "@/shared/constants";
import { registerExtensionApi } from "@/vscode/activation/RegisterExtensionApi";
import { SettingsManager, SecretsManager } from "@/vscode/storage";
import { setActiveProvider } from "./ExtensionRuntime";
import { initializeLogger, logInfo } from "@/shared/logging/Logger";
import { getWebRuntimeDiagnostics } from "@/vscode/tools/browser";
import { ExtensionCompositionRoot } from "../CompositionRoot";

type LegacySettingKey = Exclude<keyof AppConfig, "apiKey" | "userId" | "includeHomeAgents" | "interfaceLanguage" | "webSearchEnabled" | "searxngEngines" | "searxngEngineCatalog"> | "maxToolRounds" | "responseFormat" | "toolExecutionModes";

const LEGACY_SETTING_KEYS: ReadonlyArray<LegacySettingKey> = [
  "baseUrl",
  "model",
  "thinkingMode",
  "reasoningEffort",
  "temperature",
  "topP",
  "maxTokens",
  "maxToolRounds",
  "maxConcurrentGenerations",
  "responseFormat",
  "permissionMode",
  "toolExecutionModes",
  "autoContext",
  "historyEnabled",
  "historyRetentionDays",
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const diagnostics = vscode.window.createOutputChannel("YCraSy DeepSeek Agent");
  context.subscriptions.push(initializeLogger(diagnostics, "info"));
  await initializeUserSettings();
  if (SettingsManager.getPersistenceError()) {
    await vscode.window.showWarningMessage(
      "YCraSy DeepSeek Agent settings storage is unavailable. Chat remains available with temporary settings and incognito history; check access to the extension data directory and reload VS Code.",
    );
  }
  await SecretsManager.migrateLegacyApiKey(context, SettingsManager.load().baseUrl);
  const root = new ExtensionCompositionRoot(context);
  logInfo("[HeadlessWeb] Runtime snapshot", getWebRuntimeDiagnostics());
  context.subscriptions.push(root);
  setActiveProvider(root.webviewProvider);
  await root.initialize();
  registerExtensionApi(context, root.webviewProvider, root.settings);
}

async function initializeUserSettings(): Promise<void> {
  const legacyConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const legacyWebConfig = vscode.workspace.getConfiguration(`${CONFIG_SECTION}.webSearch`);
  const initialSettings: Record<string, unknown> = Object.fromEntries(LEGACY_SETTING_KEYS.map((key) => [key, legacyConfig.get(key)]));
  initialSettings.includeHomeAgents = legacyConfig.get(INCLUDE_HOME_AGENTS_KEY);
  initialSettings.webSearchEngine = "searxng";
  await SettingsManager.initialize(initialSettings);

  const removals: Thenable<void>[] = [];
  for (const key of [...LEGACY_SETTING_KEYS, INCLUDE_HOME_AGENTS_KEY]) {
    const inspected = legacyConfig.inspect(key);
    if (inspected?.globalValue !== undefined) {
      removals.push(legacyConfig.update(key, undefined, vscode.ConfigurationTarget.Global));
    }
    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      removals.push(legacyConfig.update(key, undefined, vscode.ConfigurationTarget.Workspace));
    }
  }
  for (const key of ["engine", "locale"]) {
    const inspected = legacyWebConfig.inspect(key);
    if (inspected?.globalValue !== undefined) {
      removals.push(legacyWebConfig.update(key, undefined, vscode.ConfigurationTarget.Global));
    }
    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      removals.push(legacyWebConfig.update(key, undefined, vscode.ConfigurationTarget.Workspace));
    }
  }
  await Promise.all(removals);
}

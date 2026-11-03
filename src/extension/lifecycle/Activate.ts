import * as vscode from "vscode";
import { configureUserDataDirectory, getUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { getConfiguredStorageDirectory } from "@/vscode/storage/StorageLocation";
import type { AppConfig } from "@/contracts";
import { CONFIG_SECTION, INCLUDE_HOME_AGENTS_KEY } from "@/shared/constants";
import { registerExtensionApi } from "@/vscode/activation/RegisterExtensionApi";
import { SettingsManager, SecretsManager } from "@/vscode/storage";
import { setActiveProvider } from "./ExtensionRuntime";
import { initializeLogger, logInfo, logError, showDiagnostics } from "@/shared/logging/Logger";
import { getWebRuntimeDiagnostics } from "@/vscode/tools/browser";
import { ExtensionCompositionRoot } from "../CompositionRoot";

type LegacySettingKey = Exclude<keyof AppConfig, "apiKey" | "userId" | "includeHomeAgents" | "interfaceLanguage" | "webSearchEnabled" | "capturePermission"> | "maxToolRounds" | "responseFormat" | "toolExecutionModes" | "autoContext";

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
  // Stop syncing keys registered by previous versions; local data stays intact.
  context.globalState.setKeysForSync([]);
  configureUserDataDirectory(getConfiguredStorageDirectory(context));
  await initializeUserSettings();
  await SecretsManager.migrateLegacyApiKey(context, SettingsManager.load().baseUrl);
  const root = new ExtensionCompositionRoot(context);
  logInfo("[HeadlessWeb] Runtime snapshot", getWebRuntimeDiagnostics());
  context.subscriptions.push(root);
  setActiveProvider(root.webviewProvider);
  await root.initialize();
  registerExtensionApi(context, root.webviewProvider, root.settings);
  const cleanupError = await SettingsManager.completeMigration();
  const persistenceError = SettingsManager.getPersistenceError();
  if (persistenceError || cleanupError) {
    logError("[Storage] Storage startup or migration cleanup failed", { directory: getUserDataDirectory(), error: persistenceError ?? cleanupError });
    void vscode.window.showWarningMessage(
      persistenceError ? "YCraSy DeepSeek Agent could not load or migrate your stored data. You can continue with fresh temporary settings and empty incognito history; changes will not be saved between sessions. Your existing files are preserved. Open diagnostics, fix the reported storage problem, then reload VS Code."
        : "YCraSy DeepSeek Agent loaded your data, but could not clean up temporary migration backups. You can continue normally. Open diagnostics, fix the reported storage problem, then reload VS Code.",
      "Show diagnostics",
      "Reload window",
    ).then((action) => {
      if (action === "Show diagnostics") {showDiagnostics();}
      if (action === "Reload window") {return vscode.commands.executeCommand("workbench.action.reloadWindow");}
    });
  }
}

async function initializeUserSettings(): Promise<void> {
  const legacyConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const legacyWebConfig = vscode.workspace.getConfiguration(`${CONFIG_SECTION}.webSearch`);
  const initialSettings: Record<string, unknown> = Object.fromEntries(LEGACY_SETTING_KEYS.map((key) => [key, legacyConfig.get(key)]));
  initialSettings.includeHomeAgents = legacyConfig.get(INCLUDE_HOME_AGENTS_KEY);
  await SettingsManager.initialize(initialSettings);
  if (SettingsManager.getPersistenceError()) {return;}

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

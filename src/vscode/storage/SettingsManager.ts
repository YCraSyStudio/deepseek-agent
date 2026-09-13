import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_CONFIG, type AppConfig, type PermissionSnapshot } from "@/contracts";
import {
  isStoredSettingKey,
  normalizeConfig,
  normalizeSettingValue,
  toStoredSettings,
  type StoredSettings,
} from "@/application/settings/ConfigurationSchema";
import { isRecord } from "@/shared/utils/TypeGuards";
import { withFileLock, writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { getSettingsFilePath } from "@/infrastructure/persistence/UserDataPaths";

type SettingsChangeListener = (config: AppConfig) => void;

export class SettingsManager {
  private static writeQueue: Promise<void> = Promise.resolve();
  private static currentConfig: AppConfig = normalizeConfig({});
  private static revision = 0;
  private static initialized = false;
  private static persistenceError?: string;
  private static pendingPermissionUpdates = 0;
  private static readonly changeListeners = new Set<SettingsChangeListener>();
  private static persistSettings: (settings: StoredSettings) => Promise<void> =
    (settings) => writeJsonFileAtomic(getSettingsFilePath(), settings);

  static async initialize(initialSettings: unknown = {}): Promise<void> {
    if (SettingsManager.initialized) {
      return;
    }
    try {
      await SettingsManager.enqueueWrite(() => withFileLock(getSettingsFilePath(), async () => {
        if (existsSync(getSettingsFilePath())) {
          const storedSettings = readStoredSettings();
          const normalizedConfig = normalizeConfig(storedSettings);
          if (
            isRecord(storedSettings) &&
            (Object.prototype.hasOwnProperty.call(storedSettings, "webSearchBrowserVisible") ||
              Object.prototype.hasOwnProperty.call(storedSettings, "usageBudgets") ||
              Object.prototype.hasOwnProperty.call(storedSettings, "toolExecutionModes") ||
              storedSettings.permissionMode === "workspace" ||
              storedSettings.permissionMode === "chat" ||
              storedSettings.permissionMode === "enabled" ||
              storedSettings.permissionMode === "read-only" ||
              storedSettings.permissionMode === "custom")
          ) {
            await SettingsManager.persistSettings(toStoredSettings(normalizedConfig));
          }
          SettingsManager.currentConfig = normalizedConfig;
          return;
        }
        const initialConfig = normalizeConfig(initialSettings);
        await SettingsManager.persistSettings(toStoredSettings(initialConfig));
        SettingsManager.currentConfig = initialConfig;
      }));
    } catch (error: unknown) {
      SettingsManager.currentConfig = { ...normalizeConfig(initialSettings), historyEnabled: false };
      SettingsManager.persistenceError = error instanceof Error ? error.message : String(error);
    }
    SettingsManager.initialized = true;
  }

  static onDidChange(listener: SettingsChangeListener): () => void {
    SettingsManager.changeListeners.add(listener);
    return () => SettingsManager.changeListeners.delete(listener);
  }

  static getPersistenceError(): string | undefined {
    return SettingsManager.persistenceError;
  }

  static enterDegradedMode(error: unknown): void {
    SettingsManager.persistenceError = error instanceof Error ? error.message : String(error);
    SettingsManager.currentConfig = { ...SettingsManager.currentConfig, historyEnabled: false };
    SettingsManager.revision += 1;
    SettingsManager.emitChange();
  }

  static load(): AppConfig {
    return cloneConfig(SettingsManager.currentConfig);
  }

  static getRevision(): number {
    return SettingsManager.revision;
  }

  static isPermissionUpdatePending(): boolean {
    return SettingsManager.pendingPermissionUpdates > 0;
  }

  static async waitForPendingWrites(): Promise<void> {
    await SettingsManager.writeQueue;
  }

  static async capturePermissionSnapshot(workspaceTrusted: boolean): Promise<PermissionSnapshot> {
    await SettingsManager.waitForPendingWrites();
    const config = SettingsManager.load();
    const permissionMode = workspaceTrusted ? config.permissionMode : "default";
    const revision = SettingsManager.revision;
    return Object.freeze({
      revision,
      permissionMode,
      workspaceTrusted,
      fingerprint: JSON.stringify({
        revision,
        permissionMode,
        workspaceTrusted,
      }),
    });
  }

  static save(partial: Partial<AppConfig>): Promise<void> {
    if (SettingsManager.persistenceError) {
      const next = SettingsManager.load();
      for (const [key, value] of Object.entries(partial)) {
        if (!isStoredSettingKey(key) || value === undefined || key === "historyEnabled") {continue;}
        Object.assign(next, { [key]: normalizeSettingValue(key, value) });
      }
      SettingsManager.currentConfig = { ...normalizeConfig(next), historyEnabled: false };
      SettingsManager.revision += 1;
      SettingsManager.emitChange();
      return Promise.resolve();
    }
    return SettingsManager.enqueueMutation(isPermissionAffectingPatch(partial), async () => {
      await withFileLock(getSettingsFilePath(), async () => {
        const next = existsSync(getSettingsFilePath()) ? normalizeConfig(readStoredSettings()) : SettingsManager.load();
        for (const [key, value] of Object.entries(partial)) {
          if (!isStoredSettingKey(key) || value === undefined) {continue;}
          Object.assign(next, { [key]: normalizeSettingValue(key, value) });
        }
        await SettingsManager.persistSettings(toStoredSettings(next));
        SettingsManager.currentConfig = normalizeConfig(next);
        SettingsManager.revision += 1;
      });
      SettingsManager.emitChange();
    });
  }

  static reset(): Promise<void> {
    if (SettingsManager.persistenceError) {
      SettingsManager.currentConfig = { ...normalizeConfig(DEFAULT_CONFIG), historyEnabled: false };
      SettingsManager.revision += 1;
      SettingsManager.emitChange();
      return Promise.resolve();
    }
    return SettingsManager.enqueueMutation(true, async () => {
      await withFileLock(getSettingsFilePath(), async () => {
        const next = normalizeConfig(DEFAULT_CONFIG);
        await SettingsManager.persistSettings(toStoredSettings(next));
        SettingsManager.currentConfig = next;
        SettingsManager.revision += 1;
      });
      SettingsManager.emitChange();
    });
  }

  static setPersistenceForTests(persist?: (settings: unknown) => Promise<void>): void {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Test persistence override is only available in tests");
    }
    SettingsManager.persistSettings = persist
      ? (settings) => persist(settings)
      : (settings) => writeJsonFileAtomic(getSettingsFilePath(), settings);
  }

  private static emitChange(): void {
    const snapshot = SettingsManager.load();
    for (const listener of SettingsManager.changeListeners) {
      try {listener(snapshot);} catch { }
    }
  }

  private static enqueueMutation(permissionAffecting: boolean, operation: () => Promise<void>): Promise<void> {
    if (permissionAffecting) {
      SettingsManager.pendingPermissionUpdates += 1;
    }
    return SettingsManager.enqueueWrite(operation).finally(() => {
      if (permissionAffecting) {
        SettingsManager.pendingPermissionUpdates = Math.max(0, SettingsManager.pendingPermissionUpdates - 1);
      }
    });
  }

  private static enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = SettingsManager.writeQueue.then(operation, operation);
    SettingsManager.writeQueue = next.catch(() => undefined);
    return next;
  }
}

function cloneConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    searxngEngines: [...config.searxngEngines],
    searxngEngineCatalog: config.searxngEngineCatalog.map((engine) => ({
      ...engine,
      categories: [...engine.categories],
    })),
  };
}

function isPermissionAffectingPatch(partial: Partial<AppConfig>): boolean {
  return Object.prototype.hasOwnProperty.call(partial, "permissionMode");
}

function readStoredSettings(): unknown {
  try {
    return JSON.parse(readFileSync(getSettingsFilePath(), "utf8")) as unknown;
  } catch {
    return {};
  }
}

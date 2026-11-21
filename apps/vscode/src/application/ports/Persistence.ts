import type { AppConfig, PermissionSnapshot } from "@/contracts/Config";

export interface SettingsRepository {
  load(): AppConfig;
  save(patch: Partial<AppConfig>): Promise<void>;
  reset(): Promise<void>;
  getRevision(): number;
  waitForPendingWrites(): Promise<void>;
  capturePermissionSnapshot(workspaceTrusted: boolean): Promise<PermissionSnapshot>;
  getPersistenceError(): string | undefined;
  enterDegradedMode(error: unknown): void;
}

export interface SecretStore {
  migrateLegacyApiKey(baseUrl: string): Promise<void>;
  getApiKey(baseUrl: string): Promise<string | undefined>;
  setApiKey(baseUrl: string, apiKey: string): Promise<void>;
  deleteApiKey(baseUrl: string): Promise<void>;
}

import type * as vscode from "vscode";
import type { AppConfig, PermissionSnapshot } from "@/contracts/Config";
import type { SecretStore, SettingsRepository } from "@/application/ports";
import { SecretsManager } from "./SecretsManager";
import { SettingsManager } from "./SettingsManager";

export class VsCodeSettingsRepository implements SettingsRepository {
  load(): AppConfig {return SettingsManager.load();}
  save(patch: Partial<AppConfig>): Promise<void> {return SettingsManager.save(patch);}
  reset(): Promise<void> {return SettingsManager.reset();}
  getRevision(): number {return SettingsManager.getRevision();}
  waitForPendingWrites(): Promise<void> {return SettingsManager.waitForPendingWrites();}
  capturePermissionSnapshot(workspaceTrusted: boolean): Promise<PermissionSnapshot> {
    return SettingsManager.capturePermissionSnapshot(workspaceTrusted);
  }
  getPersistenceError(): string | undefined {return SettingsManager.getPersistenceError();}
  enterDegradedMode(error: unknown): void {SettingsManager.enterDegradedMode(error);}
}

export class VsCodeSecretStore implements SecretStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  migrateLegacyApiKey(baseUrl: string): Promise<void> {
    return SecretsManager.migrateLegacyApiKey(this.context, baseUrl);
  }

  getApiKey(baseUrl: string): Promise<string | undefined> {
    return SecretsManager.getApiKey(this.context, baseUrl);
  }

  setApiKey(baseUrl: string, apiKey: string): Promise<void> {
    return SecretsManager.setApiKey(this.context, baseUrl, apiKey);
  }

  deleteApiKey(baseUrl: string): Promise<void> {
    return SecretsManager.deleteApiKey(this.context, baseUrl);
  }
}

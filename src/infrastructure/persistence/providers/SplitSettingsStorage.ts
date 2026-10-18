import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { StoredSettings, StoredSettingKey } from "@/application/settings/ConfigurationSchema";
import { isRecord } from "@/shared/utils/TypeGuards";
import { writeJsonFileAtomic } from "../JsonFileStorage";
import { getSettingsFilePath } from "../UserDataPaths";
import { getProviderDataPaths } from "./ProviderDataPaths";

export const DEEPSEEK_SETTING_KEYS: readonly StoredSettingKey[] = ["baseUrl", "model", "thinkingMode", "reasoningEffort", "temperature", "topP", "maxTokens"];
export interface SettingsStorage { read(): unknown; recover(): Promise<void>; write(settings: StoredSettings): Promise<void> }
interface Transaction { version: 1; shared: Record<string, unknown>; provider: Record<string, unknown>; sharedBefore: string | null; providerBefore: string | null }

/** Caller holds the shared settings lock, which also coordinates provider changes. */
export class SplitSettingsStorage implements SettingsStorage {
  private readonly journal: string;
  constructor(private readonly sharedFile = getSettingsFilePath(), private readonly providerFile = getProviderDataPaths("deepseek").settingsFile,
    private readonly atomicWrite = writeJsonFileAtomic) {this.journal = `${sharedFile}.transaction.json`;}
  read(): unknown {
    const shared = readObject(this.sharedFile);
    const provider = readObject(this.providerFile);
    const legacyProvider = Object.fromEntries(DEEPSEEK_SETTING_KEYS.filter((key) => key in shared).map((key) => [key, shared[key]]));
    const owned = Object.fromEntries(DEEPSEEK_SETTING_KEYS.filter((key) => key in provider).map((key) => [key, provider[key]]));
    return { ...shared, ...legacyProvider, ...owned };
  }
  async recover(): Promise<void> {
    if (!existsSync(this.journal)) {return;}
    const value = readObject(this.journal);
    if (value.version !== 1 || !isRecord(value.shared) || !isRecord(value.provider) ||
      ![value.sharedBefore, value.providerBefore].every((hash) => hash === null || (typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) ||
      Object.keys(value.provider).some((key) => !DEEPSEEK_SETTING_KEYS.includes(key as StoredSettingKey)) ||
      Object.keys(value.shared).some((key) => DEEPSEEK_SETTING_KEYS.includes(key as StoredSettingKey))) {
      throw new Error("Invalid settings transaction; preserve it for recovery");
    }
    await this.finish(value as unknown as Transaction);
  }
  async write(settings: StoredSettings): Promise<void> {
    await this.recover();
    const entries = Object.entries(settings);
    const transaction: Transaction = { version: 1,
      shared: Object.fromEntries(entries.filter(([key]) => !DEEPSEEK_SETTING_KEYS.includes(key as StoredSettingKey))),
      provider: Object.fromEntries(entries.filter(([key]) => DEEPSEEK_SETTING_KEYS.includes(key as StoredSettingKey))),
      sharedBefore: hashFile(this.sharedFile), providerBefore: hashFile(this.providerFile),
    };
    await this.atomicWrite(this.journal, transaction);
    await this.finish(transaction);
  }
  private async finish(transaction: Transaction): Promise<void> {
    const serialized = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const expected = (file: string, before: string | null, value: unknown) => {
      const current = hashFile(file);
      if (current !== before && current !== hash(serialized(value))) {throw new Error("Settings changed during interrupted migration; refusing to overwrite newer data");}
    };
    expected(this.providerFile, transaction.providerBefore, transaction.provider);
    expected(this.sharedFile, transaction.sharedBefore, transaction.shared);
    await this.atomicWrite(this.providerFile, transaction.provider);
    await this.atomicWrite(this.sharedFile, transaction.shared);
    await rm(this.journal, { force: true });
  }
}
function readObject(file: string): Record<string, unknown> {
  if (!existsSync(file)) {return {};}
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(value)) {throw new Error("Settings file must contain an object");}
  return value;
}
function hash(value: string | Buffer): string {return createHash("sha256").update(value).digest("hex");}
function hashFile(file: string): string | null {return existsSync(file) ? hash(readFileSync(file)) : null;}

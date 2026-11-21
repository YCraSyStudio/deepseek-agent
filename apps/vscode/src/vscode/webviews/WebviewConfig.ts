import type { AppConfig, WebviewConfig } from "@/contracts";

export function toWebviewConfig(config: AppConfig): WebviewConfig {
  const { apiKey: _apiKey, ...safeConfig } = config;
  return safeConfig;
}

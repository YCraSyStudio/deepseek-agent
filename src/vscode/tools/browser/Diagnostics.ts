import * as vscode from "vscode";
import type { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import type { SettingsRepository } from "@/application/ports";
import { DEFAULT_CONFIG } from "@/contracts";

let runtime: HeadlessWebRuntime | undefined;
let settings: SettingsRepository | undefined;

export function configureWebRuntimeDiagnostics(value: HeadlessWebRuntime, repository: SettingsRepository): void {
  runtime = value;
  settings = repository;
}

export function getWebRuntimeDiagnostics(): Record<string, unknown> {
  const config = settings?.load() ?? DEFAULT_CONFIG;
  return {
    backend: "searxng+bounded-http",
    nativeVsCodeTools: false,
    searchProvider: "searxng",
    searxngEndpoint: redactEndpoint(config.searxngUrl),
    resolvedSystemLocale: Intl.DateTimeFormat().resolvedOptions().locale || vscode.env.language,
    runtime: runtime?.getDiagnostics() ?? { source: "unresolved", available: false },
    vscodeVersion: vscode.version,
  };
}

function redactEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "invalid";
  }
}

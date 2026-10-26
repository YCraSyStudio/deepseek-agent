import * as vscode from "vscode";
import type { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";

let runtime: HeadlessWebRuntime | undefined;

export function configureWebRuntimeDiagnostics(value: HeadlessWebRuntime): void {runtime = value;}

export function getWebRuntimeDiagnostics(): Record<string, unknown> {
  return {
    backend: "local-chromium", searchProvider: "deepseek", nativeVsCodeTools: false,
    runtime: runtime?.getDiagnostics() ?? { source: "unresolved", available: false },
    vscodeVersion: vscode.version,
  };
}

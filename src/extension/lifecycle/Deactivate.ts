import { shutdownActiveProvider } from "./ExtensionRuntime";
import { shutdownOwnedProcesses } from "@/infrastructure/tools/builtins/terminal/ShellExecution";
import { shutdownVsCodeTerminals } from "@/vscode/tools/VsCodeTerminalExecution";
import { shutdownApplicationSessions } from "@/infrastructure/tools/builtins/terminal/ManagedApplicationSessions";

export async function deactivate(): Promise<void> {
  try {
    await shutdownActiveProvider();
  } finally {
    shutdownVsCodeTerminals();
    await shutdownApplicationSessions();
    await shutdownOwnedProcesses();
  }
}

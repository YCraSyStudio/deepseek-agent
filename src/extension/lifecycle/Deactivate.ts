import { shutdownActiveProvider } from "./ExtensionRuntime";
import { shutdownOwnedProcesses } from "@/infrastructure/tools/builtins/terminal/ShellExecution";
import { shutdownApplicationSessions } from "@/infrastructure/tools/builtins/terminal/ManagedApplicationSessions";
import { shutdownKeepAliveTerminals } from "@/infrastructure/tools/builtins/terminal/KeepAliveTerminals";

export async function deactivate(): Promise<void> {
  try {
    await shutdownActiveProvider();
  } finally {
    await shutdownApplicationSessions();
    await shutdownKeepAliveTerminals();
    await shutdownOwnedProcesses();
  }
}

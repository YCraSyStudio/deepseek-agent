import { getSystemCommandShell } from "@/infrastructure/tools/builtins/terminal/ShellExecution";
import type { WorkspaceRunSnapshot } from "@/vscode/workspace";

export function buildTerminalRuntimeNotice(
  workspaceSnapshot?: WorkspaceRunSnapshot,
  shell = getSystemCommandShell(),
  minimizeMetadata = true,
): string {
  const aliases = workspaceSnapshot?.folders.map((folder) => folder.alias) ?? [];
  const cwdNotice = aliases.length > 1
    ? `Valid cwd roots: ${workspaceSnapshot!.folders.map((folder) =>
        folder.localPath && !minimizeMetadata ? `${folder.alias} (${folder.localPath})` : folder.alias,
      ).join(", ")}. Use a root alias and a relative path; never guess another absolute path.`
    : workspaceSnapshot?.folders[0]
      ? `Active workspace root: ${minimizeMetadata ? ". (workspace-relative)" : workspaceSnapshot.folders[0].localPath ?? workspaceSnapshot.folders[0].uri}. ` +
        "Omit cwd to run there, or provide only a workspace-relative child path. Do not call a tool to discover this path."
      : "No terminal workspace root is available.";
  return `\n- Terminal shell: ${shell}. Commands run as non-interactive child processes on the extension host; output appears in chat activities. Each command starts in its requested cwd with a fresh shell; shell variables and cd changes do not persist between calls. Only when the user explicitly asks to keep a tool or server running after this turn, pass keepAlive=true with the foreground command: it starts an isolated terminal owned by this chat and returns a sessionId that keepAliveAction=status or stop can use; it also stops on chat deletion, extension shutdown, or after four hours. Use portable syntax and do not add a redundant shell wrapper. ${cwdNotice}`;
}

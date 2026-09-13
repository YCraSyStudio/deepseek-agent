import type { WorkspaceRunSnapshot } from "@/vscode/workspace";

export function buildTerminalRuntimeNotice(
  workspaceSnapshot?: WorkspaceRunSnapshot,
  shell = "VS Code integrated terminal (default profile)",
): string {
  const aliases = workspaceSnapshot?.folders.map((folder) => folder.alias) ?? [];
  const cwdNotice = aliases.length > 1
    ? `Valid cwd roots: ${workspaceSnapshot!.folders.map((folder) =>
        folder.localPath ? `${folder.alias} (${folder.localPath})` : folder.alias,
      ).join(", ")}. Use a root alias and a relative path; never guess another absolute path.`
    : workspaceSnapshot?.folders[0]
      ? `Active workspace root: ${workspaceSnapshot.folders[0].localPath ?? workspaceSnapshot.folders[0].uri}. ` +
        "Omit cwd to run there, or provide only a workspace-relative child path. Do not call a tool to discover this path."
      : "No terminal workspace root is available.";
  return `\n- Terminal shell: ${shell}. Commands run visibly in the integrated terminal through shell integration; use portable syntax and do not add a redundant shell wrapper. ${cwdNotice}`;
}

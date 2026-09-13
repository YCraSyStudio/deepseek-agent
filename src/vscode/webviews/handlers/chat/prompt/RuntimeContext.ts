import type { ChatMessage, PermissionMode, ToolDefinition } from "@/contracts";
import type { WorkspaceRunSnapshot } from "@/vscode/workspace";
import { buildTerminalRuntimeNotice } from "./TerminalRuntimeNotice";

export function appendToolAvailabilityContext(
  messages: ChatMessage[],
  permissionMode: PermissionMode,
  tools: ToolDefinition[],
  workspaceSnapshot?: WorkspaceRunSnapshot,
): void {
  const systemMessage = messages.find((message) => message.role === "system");
  if (!systemMessage) {
    return;
  }

  const availableToolNames = tools.map((tool) => tool.function.name);
  const delegatedTools = permissionMode === "auto-approve" || permissionMode === "full-access"
    ? tools.map((tool) => tool.function.name)
    : [];
  const capabilityNotice = permissionMode === "full-access"
    ? "The user enabled full computer access. Routine and elevated operations may run automatically anywhere; critical operations that could make the computer unusable or cause broad irreversible loss still require confirmation."
    : permissionMode === "auto-approve"
      ? "Routine operations are delegated inside and outside the workspace. Elevated or critical operations still require explicit confirmation."
      : "Every tool call requires confirmation. Use only the tools listed below and do not imply that unavailable capabilities can be used.";
  const delegationNotice = delegatedTools.length > 0
    ? `\n- Unattended tools: ${delegatedTools.join(", ")}. The user explicitly delegated these approvals. Each call executes immediately, so call them only when necessary, directly aligned with the request, and with the narrowest safe arguments.`
    : "";
  const terminalNotice = availableToolNames.includes("run_terminal_command")
    ? buildTerminalRuntimeNotice(workspaceSnapshot)
    : "";
  systemMessage.content = `${systemMessage.content ?? ""}\n\nRuntime permissions:\n- Permission mode: ${permissionMode}\n- Available tools: ${availableToolNames.length > 0 ? availableToolNames.join(", ") : "none"}${delegationNotice}\n- ${capabilityNotice}${terminalNotice}`;
}

import type { WorkspaceContextStatus } from "@/contracts";
import { redactSensitiveText } from "@/shared/security/Redaction";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? redactSensitiveText(error)
    : "Unexpected error while connecting to the API";
}

export function getWorkspaceStatusError(status: WorkspaceContextStatus): string {
  if (status.state === "changed") {
    return `Workspace "${status.binding.name}" changed. Confirm or reassign the workspace before continuing.`;
  }
  if (status.state === "empty") {
    return "Open a workspace before starting a generation.";
  }
  return `Workspace "${status.binding.name}" is disconnected. Open it or reassign this conversation.`;
}

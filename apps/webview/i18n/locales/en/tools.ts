import type { TranslationCatalog } from "../Types";

export const tools = {
  tools: {
    permissionMode: "Permission mode",
    defaultDescription: "Every tool call requires confirmation.",
    fullAccessDescription: "Routine and elevated operations run automatically anywhere. Confirmation is reserved for critical actions that could make the computer unusable or cause broad irreversible loss.",
    default: "Default",
    fullAccess: "Full access",
    autoApprove: "Auto approve",
    autoApproveModeDescription: "Routine operations run automatically inside and outside the workspace. Elevated or critical operations require confirmation.",
    fullAccessWarning: "Enable full access? Routine and elevated operations may run anywhere. Critical actions that could make the computer unusable or cause broad irreversible loss still require confirmation.",
    toolCalls: "Tool calls",
    toolCall: "Tool call",
    pending: "Pending",
    awaitingConfirmation: "Awaiting confirmation",
    running: "Running",
    completed: "Completed",
    error: "Error",
    rejected: "Rejected",
    cancelled: "Cancelled",
    openFile: "Open file",
    reviewTurn: "Review changes",
    revertTurn: "Revert turn",
    turnReverted: "Turn reverted",
    viewChange: "View change",
    editedFilesOne: "Edited 1 file",
    editedFilesMany: "Edited {count} files",
    showMoreFiles: "Show {count} more files",
    hideExtraFiles: "Show fewer files",
    copy: "Copy",
    insert: "Insert",
  }
} satisfies TranslationCatalog;

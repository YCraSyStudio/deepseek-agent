import type { AssistantTimelineEvent, ConversationMessage, DangerConfirmationData, StoredToolCall, WorkspaceBinding } from "@/contracts";
import { isImageAttachmentShape } from "@/contracts/attachments";
import { isConversationContextSummary, isProviderTranscript, type StoredConversation } from "./ProviderTranscript";
import { isUsageAggregate } from "@/shared/usage/Usage";
import { isRecord } from "@/shared/utils/TypeGuards";
import { isBoundedString } from "@/shared/utils/Validation";

const MAX_IMAGE_ATTACHMENT_BYTES = 64 * 1024 * 1024;

export function isConversation(value: unknown): value is StoredConversation {
  if (!isRecord(value) || !isBoundedString(value.id, 512) || !isBoundedString(value.title, 4096) || !isBoundedString(value.model, 256) || !isBoundedString(value.workspaceUri, 32_768)) {
    return false;
  }
  if (value.schemaVersion !== 2) {
    return false;
  }
  if (!isWorkspaceBinding(value.workspaceBinding)) {
    return false;
  }
  if (value.workspaceUri !== value.workspaceBinding.uri) {
    return false;
  }
  if (value.contextSummary !== undefined && !isConversationContextSummary(value.contextSummary)) {
    return false;
  }
  if (value.workspaceRebindings !== undefined && (
    !Array.isArray(value.workspaceRebindings) ||
    value.workspaceRebindings.length > 100 ||
    !value.workspaceRebindings.every((entry) =>
      isRecord(entry) &&
      isBoundedString(entry.fromWorkspaceUri, 32_768) &&
      isBoundedString(entry.toWorkspaceUri, 32_768) &&
      isTimestamp(entry.at)
    )
  )) {
    return false;
  }
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || !Array.isArray(value.messages) || value.messages.length > 10_000) {
    return false;
  }
  return value.messages.every(isConversationMessage);
}

export function isWorkspaceBinding(value: unknown): value is WorkspaceBinding {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isBoundedString(value.uri, 32_768) || !isBoundedString(value.name, 4096) || !isBoundedString(value.revision, 128)) {
    return false;
  }
  if (!Array.isArray(value.folders) || value.folders.length > 128 || !value.folders.every((folder) =>
    isRecord(folder) &&
    isBoundedString(folder.uri, 32_768) &&
    isBoundedString(folder.name, 4096) &&
    isBoundedString(folder.alias, 4096) &&
    isBoundedString(folder.scheme, 128)
  )) {
    return false;
  }
  return isRecord(value.capabilities) &&
    typeof value.capabilities.files === "boolean" &&
    typeof value.capabilities.search === "boolean" &&
    typeof value.capabilities.git === "boolean" &&
    typeof value.capabilities.terminal === "boolean";
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!isRecord(value) || !isBoundedString(value.id, 512) || !["user", "assistant", "error", "tool", "context"].includes(value.role as string) || !isBoundedString(value.content, 5 * 1024 * 1024)) {
    return false;
  }
  if (value.createdAt !== undefined && !isTimestamp(value.createdAt)) {
    return false;
  }
  if (value.generationId !== undefined && !isBoundedString(value.generationId, 512)) {
    return false;
  }
  if (value.generationStatus !== undefined && !["completed", "cancelled", "interrupted", "error"].includes(value.generationStatus as string)) {
    return false;
  }
  if (value.generationStopReason !== undefined && ![
    "user_cancelled",
    "steered",
    "workspace_changed",
    "shutdown",
    "deleted",
    "history_transition",
  ].includes(value.generationStopReason as string)) {
    return false;
  }
  if (value.timeline !== undefined && (!Array.isArray(value.timeline) || value.timeline.length > 10_000 || !value.timeline.every(isTimelineEvent))) {
    return false;
  }
  if (value.toolCalls !== undefined && (!Array.isArray(value.toolCalls) || value.toolCalls.length > 1_000 || !value.toolCalls.every(isStoredToolCall))) {
    return false;
  }
  if (value.imageAttachments !== undefined && (
    !Array.isArray(value.imageAttachments) ||
    value.imageAttachments.length > 600 ||
    !value.imageAttachments.every(isImageAttachment)
  )) {return false;}
  return (value.toolCallId === undefined || isBoundedString(value.toolCallId, 512)) &&
    (value.toolName === undefined || isBoundedString(value.toolName, 256)) &&
    (value.contextContent === undefined || isBoundedString(value.contextContent, 5 * 1024 * 1024)) &&
    (value.providerTranscript === undefined || isProviderTranscript(value.providerTranscript)) &&
    (value.usage === undefined || isUsageAggregate(value.usage));
}

function isImageAttachment(value: unknown): boolean {
  return isImageAttachmentShape(value) && Number(value.size) <= MAX_IMAGE_ATTACHMENT_BYTES;
}

function isTimelineEvent(value: unknown): value is AssistantTimelineEvent {
  if (!isRecord(value) || !isBoundedString(value.id, 512)) {
    return false;
  }
  if (value.type === "reasoning" || value.type === "content") {
    return isBoundedString(value.content, 5 * 1024 * 1024);
  }
  return (
    value.type === "tool-group" &&
    Number.isSafeInteger(value.round) &&
    (value.round as number) >= 1 &&
    Array.isArray(value.toolCallIds) &&
    value.toolCallIds.length <= 1_000 &&
    value.toolCallIds.every((id) => isBoundedString(id, 512))
  );
}

function isStoredToolCall(value: unknown): value is StoredToolCall {
  if (!isRecord(value) || !isBoundedString(value.toolCallId, 512) || !isBoundedString(value.toolName, 256) || !isBoundedString(value.arguments, 5 * 1024 * 1024)) {
    return false;
  }
  return (
    (value.result === undefined || isBoundedString(value.result, 5 * 1024 * 1024)) &&
    (value.isError === undefined || typeof value.isError === "boolean") &&
    (value.round === undefined || (Number.isSafeInteger(value.round) && (value.round as number) >= 1)) &&
    (value.rejected === undefined || typeof value.rejected === "boolean") &&
    (value.requiresConfirmation === undefined || typeof value.requiresConfirmation === "boolean") &&
    (value.dangerLevel === undefined || ["safe", "caution", "dangerous", "destructive"].includes(value.dangerLevel as string)) &&
    (value.dangerConfirmed === undefined || typeof value.dangerConfirmed === "boolean") &&
    (value.dangerConfirmation === undefined || isDangerConfirmationData(value.dangerConfirmation)) &&
    ["pending", "awaiting_confirmation", "running", "completed", "rejected", "cancelled", "error"].includes(value.status as string)
  );
}

export function isDangerConfirmationData(value: unknown): value is DangerConfirmationData {
  if (!isRecord(value) || value.requiresConfirmation !== true ||
    !["safe", "caution", "dangerous", "destructive"].includes(value.dangerLevel as string) ||
    !isBoundedString(value.warningMessage, 32_768)) {
    return false;
  }
  return ["command", "filePath", "cwd", "shell", "beforeHash"].every((key) =>
    value[key] === undefined || isBoundedString(value[key], 5 * 1024 * 1024)
  );
}


function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

import { MAX_OUTPUT_TOKENS, WEBVIEW_INPUT_LIMITS, WEBVIEW_PROTOCOL_VERSION, isReasoningEffort, type AppConfig, type WebviewToHandlerMessage } from "@/contracts";
import { isAllowedApiBaseUrl } from "@/shared/security/ApiOrigin";
import { SETTING_KEYS_LIST } from "@/application/settings/ConfigurationSchema";
import { isImageAttachmentShape } from "@/contracts/attachments";
import { isRecord } from "@/shared/utils/TypeGuards";
import {
  hasOnlyKeys,
  isBoundedString,
  isEnumOf,
  isNonEmptyBoundedString,
  isOptionalBoolean,
  isOptionalBoundedString,
  isOptionalNumberInRange,
} from "@/shared/utils/Validation";

const MAX_CHAT_TEXT = WEBVIEW_INPUT_LIMITS.chatText;
const MAX_CODE_TEXT = 2 * 1024 * 1024;
const MAX_CHANGE_DIFF_TEXT = 2 * 1024 * 1024;
const MAX_REFERENCE_CONTENT = WEBVIEW_INPUT_LIMITS.referenceContent;
const MAX_TOTAL_REFERENCE_CONTENT = WEBVIEW_INPUT_LIMITS.totalReferenceContent;
const MAX_REFERENCES = WEBVIEW_INPUT_LIMITS.references;

export function isWebviewToHandlerMessage(value: unknown): value is WebviewToHandlerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "initializeProtocol":
      return hasOnlyKeys(value, ["type", "protocolVersion"]) && value.protocolVersion === WEBVIEW_PROTOCOL_VERSION;
    case "getConfig":
    case "getHistory":
    case "getAvailableTools":
    case "getGenerationSnapshot":
      return hasOnlyKeys(value, ["type"]);
    case "newConversation":
      return hasOnlyKeys(value, ["type", "requestId"]) && isNonEmptyBoundedString(value.requestId, 128);
    case "selectAttachments":
      return hasOnlyKeys(value, ["type", "requestId", "conversationId"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512));
    case "uploadClipboardImage":
      return hasOnlyKeys(value, ["type", "requestId", "name", "mediaType", "size", "dataBase64"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        isNonEmptyBoundedString(value.name, 512) &&
        typeof value.mediaType === "string" && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(value.mediaType) &&
        Number.isSafeInteger(value.size) && (value.size as number) > 0 && (value.size as number) <= WEBVIEW_INPUT_LIMITS.clipboardImageBytes &&
        isNonEmptyBoundedString(value.dataBase64, Math.ceil(WEBVIEW_INPUT_LIMITS.clipboardImageBytes * 4 / 3) + 8) &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value.dataBase64);
    case "deleteImageAttachment":
      return hasOnlyKeys(value, ["type", "requestId", "attachment"]) &&
        isNonEmptyBoundedString(value.requestId, 128) && isImageAttachment(value.attachment);
    case "getWorkspaceContext":
      return hasOnlyKeys(value, ["type", "requestId", "conversationId"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512));
    case "rebindConversationWorkspace":
      return hasOnlyKeys(value, ["type", "conversationId", "workspaceRevision"]) &&
        isNonEmptyBoundedString(value.conversationId, 512) &&
        isOptionalBoundedString(value.workspaceRevision, 256);
    case "openConversationWorkspace":
      return hasOnlyKeys(value, ["type", "conversationId"]) &&
        isNonEmptyBoundedString(value.conversationId, 512);
    case "resetConfig":
    case "deleteApiKey":
      return hasOnlyKeys(value, ["type", "requestId"]) && isNonEmptyBoundedString(value.requestId, 128);
    case "resolveHistoryTransition":
      return hasOnlyKeys(value, ["type", "requestId", "decision"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        (value.decision === "stop" || value.decision === "save" || value.decision === "discard" || value.decision === "cancel");
    case "cancelGeneration":
      return hasOnlyKeys(value, ["type", "requestId", "generationId", "conversationId"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        isNonEmptyBoundedString(value.generationId, 512) &&
        isNonEmptyBoundedString(value.conversationId, 512);
    case "compactContext":
      return hasOnlyKeys(value, ["type", "requestId", "conversationId"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512));
    case "consumeRecoveredDraft":
      return hasOnlyKeys(value, ["type", "conversationId", "clientRequestId"]) &&
        isNonEmptyBoundedString(value.conversationId, 512) &&
        isNonEmptyBoundedString(value.clientRequestId, 512);
    case "saveConfig":
      return hasOnlyKeys(value, ["type", "requestId", "config"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        isAppConfigPatch(value.config);
    case "testConnection":
      return (
        hasOnlyKeys(value, ["type", "apiKey", "baseUrl", "model"]) &&
        (value.apiKey === undefined || isNonEmptyBoundedString(value.apiKey, 16_384)) &&
        isAllowedApiBaseUrl(value.baseUrl) &&
        isNonEmptyBoundedString(value.model, 256)
      );
    case "sendMessage":
      return validateSendMessage(value);
    case "steerGeneration":
      return validateSendMessageFields(value, ["type", "generationId", "clientRequestId", "text", "modelId", "reasoning", "conversationId", "workspaceRevision", "referencedFiles", "imageAttachments"]) &&
        isNonEmptyBoundedString(value.generationId, 512) &&
        isNonEmptyBoundedString(value.conversationId, 512);
    case "copyCode":
      return hasOnlyKeys(value, ["type", "code"]) && isBoundedString(value.code, MAX_CODE_TEXT);
    case "insertCode":
      return hasOnlyKeys(value, ["type", "code", "conversationId", "workspaceRevision"]) &&
        isBoundedString(value.code, MAX_CODE_TEXT) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512)) &&
        isOptionalBoundedString(value.workspaceRevision, 256);
    case "selectModel":
      return hasOnlyKeys(value, ["type", "modelId"]) && isNonEmptyBoundedString(value.modelId, 256);
    case "deleteConversation":
      return hasOnlyKeys(value, ["type", "id"]) && isNonEmptyBoundedString(value.id, 512);
    case "loadConversation":
      return hasOnlyKeys(value, ["type", "requestId", "id"]) &&
        isNonEmptyBoundedString(value.requestId, 128) && isNonEmptyBoundedString(value.id, 512);
    case "loadConversationPage":
      return hasOnlyKeys(value, ["type", "requestId", "id", "cursor"]) &&
        isNonEmptyBoundedString(value.requestId, 128) &&
        isNonEmptyBoundedString(value.id, 512) && isNonEmptyBoundedString(value.cursor, 512);
    case "deleteConversations":
      return hasOnlyKeys(value, ["type", "ids"]) && Array.isArray(value.ids) && value.ids.length <= 100 && value.ids.every((id) => isNonEmptyBoundedString(id, 512));
    case "executeToolCall":
      return (
        hasOnlyKeys(value, ["type", "generationId", "toolCallId", "action"]) &&
        isNonEmptyBoundedString(value.generationId, 512) &&
        isNonEmptyBoundedString(value.toolCallId, 512) &&
        (value.action === "execute" || value.action === "reject")
      );
    case "getPathCompletions":
      return (
        hasOnlyKeys(value, ["type", "requestId", "query", "conversationId", "workspaceRevision"]) &&
        Number.isSafeInteger(value.requestId) &&
        (value.requestId as number) >= 0 &&
        isBoundedString(value.query, 4096) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512)) &&
        isOptionalBoundedString(value.workspaceRevision, 256)
      );
    case "openFile":
      return (
        hasOnlyKeys(value, ["type", "path", "line", "conversationId", "workspaceRevision"]) &&
        isNonEmptyBoundedString(value.path, 32_768) &&
        (value.line === undefined || (Number.isSafeInteger(value.line) && (value.line as number) >= 1)) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512)) &&
        isOptionalBoundedString(value.workspaceRevision, 256)
      );
    case "openFileDiff":
      return (
        hasOnlyKeys(value, ["type", "path", "diff", "beforeHash", "afterHash", "preview", "conversationId", "workspaceRevision"]) &&
        isNonEmptyBoundedString(value.path, 32_768) &&
        (value.diff === undefined || isBoundedString(value.diff, MAX_CHANGE_DIFF_TEXT)) &&
        (isNonEmptyBoundedString(value.diff, MAX_CHANGE_DIFF_TEXT) || isNonEmptyBoundedString(value.afterHash, 64)) &&
        isOptionalBoundedString(value.beforeHash, 64) &&
        isOptionalBoundedString(value.afterHash, 64) &&
        isOptionalBoolean(value.preview) &&
        (value.conversationId === undefined || isNonEmptyBoundedString(value.conversationId, 512)) &&
        isOptionalBoundedString(value.workspaceRevision, 256)
      );
    default:
      return false;
  }
}

function validateSendMessage(value: Record<string, unknown>): boolean {
  return validateSendMessageFields(value, ["type", "clientRequestId", "text", "modelId", "reasoning", "conversationId", "workspaceRevision", "referencedFiles", "imageAttachments"]);
}

function validateSendMessageFields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  if (
    !hasOnlyKeys(value, keys) ||
    !isNonEmptyBoundedString(value.clientRequestId, 512) ||
    !isBoundedString(value.text, MAX_CHAT_TEXT) ||
    !isNonEmptyBoundedString(value.modelId, 256) ||
    (value.reasoning !== "off" && value.reasoning !== "low" && value.reasoning !== "high" && value.reasoning !== "max") ||
    (value.conversationId !== undefined && !isNonEmptyBoundedString(value.conversationId, 512)) ||
    !isOptionalBoundedString(value.workspaceRevision, 256)
  ) {
    return false;
  }

  if (!value.text.trim() && (!Array.isArray(value.imageAttachments) || value.imageAttachments.length === 0)) {
    return false;
  }

  if (value.imageAttachments !== undefined && (
    !Array.isArray(value.imageAttachments) ||
    value.imageAttachments.length > WEBVIEW_INPUT_LIMITS.images ||
    !value.imageAttachments.every(isImageAttachment)
  )) {
    return false;
  }

  if (value.referencedFiles === undefined) {
    return true;
  }
  if (!Array.isArray(value.referencedFiles) || value.referencedFiles.length > MAX_REFERENCES) {
    return false;
  }

  let totalContent = 0;
  for (const reference of value.referencedFiles) {
    if (
      !isRecord(reference) ||
      !hasOnlyKeys(reference, ["path", "content", "type", "selection", "referenceId", "scope", "rootUri", "bindingRevision"]) ||
      !isNonEmptyBoundedString(reference.path, 32_768) ||
      (reference.type !== "file" && reference.type !== "directory") ||
      (reference.content !== undefined && !isBoundedString(reference.content, MAX_REFERENCE_CONTENT)) ||
      (reference.selection !== undefined && !isSelectionRange(reference.selection)) ||
      (reference.referenceId !== undefined && !isNonEmptyBoundedString(reference.referenceId, 512)) ||
      (reference.scope !== undefined && reference.scope !== "workspace" && reference.scope !== "external-snapshot") ||
      !isOptionalBoundedString(reference.rootUri, 32_768) ||
      !isOptionalBoundedString(reference.bindingRevision, 256)
    ) {
      return false;
    }
    totalContent += typeof reference.content === "string" ? reference.content.length : 0;
    if (totalContent > MAX_TOTAL_REFERENCE_CONTENT) {
      return false;
    }
  }
  return true;
}

function isImageAttachment(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "fileId", "name", "mediaType", "size", "source", "uploadedAt", "expiresAt",
    "apiBaseUrl", "cacheFileName", "previewUri",
  ])) {return false;}
  return isImageAttachmentShape(value) &&
    isNonEmptyBoundedString(value.id, 512) &&
    isNonEmptyBoundedString(value.fileId, 512) &&
    isNonEmptyBoundedString(value.name, 512) &&
    (value.size as number) <= WEBVIEW_INPUT_LIMITS.imageBytes &&
    isAllowedApiBaseUrl(value.apiBaseUrl) &&
    isNonEmptyBoundedString(value.cacheFileName, 256);
}

function isSelectionRange(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["startLine", "startCharacter", "endLine", "endCharacter"]) &&
    [value.startLine, value.startCharacter, value.endLine, value.endCharacter].every((part) => Number.isSafeInteger(part) && (part as number) >= 1);
}

const INTERFACE_LANGUAGES = ["auto", "en", "es", "zh"] as const;
const PERMISSION_MODES = ["default", "auto-approve", "full-access"] as const;
const USAGE_CURRENCIES = ["usd", "cny"] as const;

const WEBVIEW_FORBIDDEN_SETTING_KEYS: ReadonlyArray<keyof AppConfig> = ["searxngEngineCatalog"];
const WEBVIEW_ONLY_CONFIG_KEYS: ReadonlyArray<keyof AppConfig> = ["apiKey", "userId"];

/** Derived from the stored settings so a new persisted key cannot be forgotten here. */
const APP_CONFIG_KEYS: ReadonlyArray<keyof AppConfig> = [
  ...SETTING_KEYS_LIST.filter((key) => !WEBVIEW_FORBIDDEN_SETTING_KEYS.includes(key)),
  ...WEBVIEW_ONLY_CONFIG_KEYS,
];

function isAppConfigPatch(value: unknown): value is Partial<AppConfig> {
  if (!isRecord(value) || !hasOnlyKeys(value, APP_CONFIG_KEYS)) {
    return false;
  }

  return (
    (value.interfaceLanguage === undefined || isEnumOf(value.interfaceLanguage, INTERFACE_LANGUAGES)) &&
    isOptionalBoundedString(value.apiKey, 16_384) &&
    (value.baseUrl === undefined || isAllowedApiBaseUrl(value.baseUrl)) &&
    (value.model === undefined || isNonEmptyBoundedString(value.model, 256)) &&
    isOptionalBoolean(value.thinkingMode) &&
    (value.reasoningEffort === undefined || isReasoningEffort(value.reasoningEffort)) &&
    isOptionalNumberInRange(value.temperature, 0, 2) &&
    isOptionalNumberInRange(value.topP, 0, 1) &&
    (value.maxTokens === undefined || (Number.isSafeInteger(value.maxTokens) && (value.maxTokens as number) >= 1 && (value.maxTokens as number) <= MAX_OUTPUT_TOKENS)) &&
    (value.maxConcurrentGenerations === undefined || (Number.isSafeInteger(value.maxConcurrentGenerations) && (value.maxConcurrentGenerations as number) >= 1 && (value.maxConcurrentGenerations as number) <= 16)) &&
    (value.permissionMode === undefined || isEnumOf(value.permissionMode, PERMISSION_MODES)) &&
    isOptionalBoolean(value.autoContext) &&
    isOptionalBoolean(value.historyEnabled) &&
    (value.historyRetentionDays === undefined || (Number.isSafeInteger(value.historyRetentionDays) && (value.historyRetentionDays as number) >= 0 && (value.historyRetentionDays as number) <= 3650)) &&
    isOptionalBoolean(value.includeHomeAgents) &&
    isOptionalBoolean(value.usageBreakdown) &&
    (value.usageCostCurrency === undefined || isEnumOf(value.usageCostCurrency, USAGE_CURRENCIES)) &&
    isOptionalBoolean(value.webSearchEnabled) &&
    (value.webSearchEngine === undefined || value.webSearchEngine === "bing" || value.webSearchEngine === "google" || value.webSearchEngine === "baidu" || value.webSearchEngine === "searxng") &&
    (value.searxngUrl === undefined || isAllowedSearxngUrl(value.searxngUrl)) &&
    (value.searxngEngines === undefined || isSearxngEngineSelection(value.searxngEngines)) &&
    isOptionalBoundedString(value.userId, 256)
  );
}

function isAllowedSearxngUrl(value: unknown): boolean {
  if (!isNonEmptyBoundedString(value, 2048)) {return false;}
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) {return false;}
    const hostname = url.hostname.toLowerCase();
    const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback);
  } catch {return false;}
}

function isSearxngEngineSelection(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 512 && value.every((item) =>
    typeof item === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(item));
}


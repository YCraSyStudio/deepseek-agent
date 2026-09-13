import type { ToolCallState } from "@webview/views/chatView/ChatViewTypes";
import { parseStructuredToolResult } from "@webview/views/chatView/utils/FileType";

const EDITOR_FILE_TOOLS = new Set([
  "read_file",
  "read_func",
  "create_file",
  "edit_file",
  "apply_patch",
]);
const FILE_EDIT_TOOLS = new Set(["create_file", "edit_file", "apply_patch"]);
const MAX_CHANGE_DIFF_TEXT = 2 * 1024 * 1024;
const DOCUMENT_HASH = /^[a-f0-9]{64}$/;

export interface ToolCallFileChange {
  path: string;
  diff?: string;
  beforeHash?: string;
  afterHash?: string;
  stats?: { additions: number; deletions: number };
}

export function isEditorFileTool(toolName: string): boolean {
  return EDITOR_FILE_TOOLS.has(toolName);
}

export function getToolCallFilePath(
  toolCall: Pick<ToolCallState, "toolName" | "arguments">,
): string | undefined {
  if (!isEditorFileTool(toolCall.toolName)) {
    return undefined;
  }
  try {
    const args = JSON.parse(toolCall.arguments) as unknown;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return undefined;
    }
    const filePath = (args as { path?: unknown }).path;
    return typeof filePath === "string" && filePath.trim()
      ? filePath
      : undefined;
  } catch {
    return undefined;
  }
}

export function hidesSuccessfulFileResult(toolCall: Pick<ToolCallState, "toolName" | "status">): boolean {
  return toolCall.status === "completed" && isEditorFileTool(toolCall.toolName);
}

export function getToolCallFileChange(
  toolCall: Pick<ToolCallState, "toolName" | "status" | "result">,
): ToolCallFileChange | undefined {
  if (
    toolCall.status !== "completed" ||
    !FILE_EDIT_TOOLS.has(toolCall.toolName) ||
    !toolCall.result
  ) {
    return undefined;
  }

  const result = parseStructuredToolResult(toolCall.result);
  if (
    !result ||
    (result.type !== "fileWrite" && result.type !== "fileEdit" && result.type !== "filePatch") ||
    typeof result.path !== "string" ||
    !result.path.trim()
  ) {
    return undefined;
  }

  const expectedType =
    toolCall.toolName === "create_file"
      ? "fileWrite"
      : toolCall.toolName === "edit_file"
        ? "fileEdit"
        : "filePatch";
  if (result.type !== expectedType || (result.type === "fileWrite" && result.binary === true)) {
    return undefined;
  }

  const diff = viewableDiff(result.diff, result.diffTruncated);
  const beforeHash = viewableHash(result.beforeHash);
  const afterHash = viewableHash(result.afterHash);
  if (!diff && !afterHash) {
    return undefined;
  }

  const change: ToolCallFileChange = { path: result.path };
  if (diff) {
    change.diff = diff;
  }
  if (beforeHash) {
    change.beforeHash = beforeHash;
  }
  if (afterHash) {
    change.afterHash = afterHash;
  }
  const stats = viewableStats(result.diffStats);
  if (stats) {
    change.stats = stats;
  }
  return change;
}

function viewableDiff(diff: unknown, truncated: unknown): string | undefined {
  return typeof diff === "string" &&
    truncated !== true &&
    diff.length <= MAX_CHANGE_DIFF_TEXT &&
    /^@@ /m.test(diff)
    ? diff
    : undefined;
}

function viewableHash(value: unknown): string | undefined {
  return typeof value === "string" && DOCUMENT_HASH.test(value) ? value : undefined;
}

function viewableStats(value: unknown): { additions: number; deletions: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const stats = value as { additions?: unknown; deletions?: unknown };
  return {
    additions: toCount(stats.additions),
    deletions: toCount(stats.deletions),
  };
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

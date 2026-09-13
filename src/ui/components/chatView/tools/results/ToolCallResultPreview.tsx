import type { VsCodeApi } from "@webview/VsCodeApi";
import type { ToolCallState } from "@webview/views/chatView/ChatViewTypes";
import { hidesSuccessfulFileResult } from "./FileToolPresentation";
import { detectDiff } from "@webview/views/chatView/utils/Format";
import { parseStructuredToolResult, parseTerminalCommandResult } from "@webview/views/chatView/utils/FileType";
import {
  renderDiffPreview,
  renderPlainResult,
  renderSearchPreview,
  renderSearchResults,
  renderStructuredFilePreview,
  renderTerminalResult,
  renderWriteSummary,
} from "./ToolCallResultRenderers";
import "./ToolCallResultPreview.css";

interface ResultPreviewOptions {
  toolCall: ToolCallState;
  vscode: VsCodeApi | null;
}

export function renderToolCallResultPreview({ toolCall, vscode }: ResultPreviewOptions) {
  const result = toolCall.result;
  if (!result) {
    return null;
  }

  if (hidesSuccessfulFileResult(toolCall)) {
    return null;
  }

  if (toolCall.toolName === "read_file") {
    return renderPlainResult(result, toolCall.status);
  }

  if (toolCall.toolName === "run_terminal_command") {
    const terminalResult = parseTerminalCommandResult(result);
    if (terminalResult) {
      return renderTerminalResult(terminalResult);
    }
  }

  const structured = parseStructuredToolResult(result);
  if (structured?.type === "file") {
    return renderStructuredFilePreview(structured);
  }

  if (structured?.type === "SearchResults") {
    return renderSearchResults(structured.results, vscode, structured.truncated);
  }

  if (structured?.type === "fileWrite") {
    if (toolCall.toolName === "create_file") {
      return null;
    }

    return structured.diff
      ? renderDiffPreview(structured.diff, {
          summary: structured.summary,
          path: structured.path,
          stats: structured.diffStats,
          truncated: structured.diffTruncated,
          binary: structured.binary,
          beforeSize: structured.beforeSize,
          afterSize: structured.afterSize,
        })
      : renderWriteSummary(structured.summary, structured.path, {
          binary: structured.binary,
          beforeSize: structured.beforeSize,
          afterSize: structured.afterSize,
        });
  }

  if (structured?.type === "fileEdit" || structured?.type === "filePatch") {
    return renderDiffPreview(structured.diff, {
      summary: structured.summary,
      path: structured.path,
      stats: structured.diffStats,
      truncated: structured.diffTruncated,
      beforeSize: structured.beforeSize,
      afterSize: structured.afterSize,
    });
  }

  if (structured?.type === "fileMove" || structured?.type === "fileDelete") {
    return renderWriteSummary(structured.summary, structured.path);
  }

  if (toolCall.toolName === "search_content") {
    return renderSearchPreview(result, toolCall.status, vscode);
  }

  if (toolCall.toolName === "create_file" && detectDiff(result)) {
    return renderDiffPreview(result, { summary: "File changed" });
  }

  return renderPlainResult(result, toolCall.status);
}

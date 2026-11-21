import type { StructuredToolResult } from "@webview/views/chatView/utils/FilePreviewTypes";
import { detectLanguage, extractFilename } from "@webview/views/chatView/utils/FileType";
import { formatSize } from "@webview/views/chatView/utils/Format";
import { t } from "@webview/i18n";
import { isEditorFileTool } from "./FileToolPresentation";

type StructuredFileResult = Extract<StructuredToolResult, { type: "file" }>;
type DiffStats = { additions: number; deletions: number };
type WriteMetadata = { binary?: boolean; beforeSize?: number; afterSize?: number };
type DiffPreviewOptions = WriteMetadata & {
  summary?: string;
  path?: string;
  stats?: DiffStats;
  truncated?: boolean;
};

export { renderSearchPreview, renderSearchResults } from "./SearchResultRenderer";
export { renderTerminalResult } from "./TerminalResultRenderer";

export function renderStructuredFilePreview(result: StructuredFileResult) {
  const filename = extractFilename(result.path);
  if (result.binary) {
    return renderBinaryHeader(filename, result.size, t("results.binaryPreviewUnavailable"));
  }

  const language = detectLanguage(filename);
  return renderCodePreview({ filename, language, size: result.size, previewSize: result.previewSize, content: result.content, truncated: result.truncated });
}

export function renderToolCallArgumentsPreview(toolName: string, argumentsJson: string) {
  const parsed = parseArguments(argumentsJson);
  if (!parsed) {
    return renderCodePreview({ filename: "arguments.txt", language: "text", size: argumentsJson.length, content: truncate(argumentsJson, 4000) });
  }

  if (toolName === "run_terminal_command" || toolName === "application_session") {
    const command = typeof parsed.command === "string" ? parsed.command
      : `${String(parsed.action ?? "")} ${String(parsed.session_id ?? "")}`.trim();
    return <pre className="terminalCommand">{command}</pre>;
  }

  const path = typeof parsed.path === "string" ? parsed.path : undefined;
  const filename = path ? formatRelativePath(path) : `${toolName}.json`;
  const content = getPreviewContent(toolName, parsed);

  if (path && isEditorFileTool(toolName)) {
    return renderToolCallSummaryPreview(
      toolName === "read_file"
        ? `${t("chat.readingPath", { path: formatRelativePath(path) })}${describeLineRange(parsed)}`
        : `${formatRelativePath(path)}${describeRequestedNames(parsed.names)}`,
    );
  }

  if (toolName === "list_directory") {
    return renderToolCallSummaryPreview(t("chat.listingPath", { path: formatRelativePath(path || ".") }));
  }

  if (content) {
    const language = detectLanguage(filename);
    return renderCodePreview({ filename, language, size: content.length, content: truncate(content, 8000), showMetadata: false });
  }

  const formatted = JSON.stringify(parsed, null, 2);
  return renderCodePreview({ filename, language: "json", size: formatted.length, content: truncate(formatted, 4000), showMetadata: false });
}

export function renderWriteSummary(summary: string, path: string, metadata: WriteMetadata = {}) {
  return (
    <div className="filePreview writePreview">
      <div className="filePreviewHeader">
        <span className="filePreviewName">{path}</span>
        {metadata.beforeSize !== undefined && <span className="filePreviewSize">{t("results.beforeSize", { size: formatSize(metadata.beforeSize) })}</span>}
        {metadata.afterSize !== undefined && <span className="filePreviewSize">{t("results.afterSize", { size: formatSize(metadata.afterSize) })}</span>}
        {metadata.binary && <span className="filePreviewType">{t("results.binarySource")}</span>}
      </div>
      <div className="writeSummary">{summary}</div>
      {metadata.binary && <div className="filePreviewNotice">{t("results.binaryDiffUnavailable")}</div>}
    </div>
  );
}

function renderToolCallSummaryPreview(summary: string) {
  return <div className="toolCallSummaryPreview">{summary}</div>;
}

export function renderDiffPreview(result: string, options: DiffPreviewOptions | string = {}) {
  const normalizedOptions: DiffPreviewOptions = typeof options === "string" ? { summary: options } : options;
  const parsed = parseDiff(result);
  const stats = normalizedOptions.stats || parsed.stats;
  const summary = normalizedOptions.summary || normalizedOptions.path || t("chat.fileChanged");

  return (
    <div className="filePreview diffPreview">
      <div className="filePreviewHeader">
        <span className="filePreviewName">{summary}</span>
        <span className="filePreviewSize">+{stats.additions}</span>
        <span className="filePreviewSize">-{stats.deletions}</span>
        {normalizedOptions.afterSize !== undefined && <span className="filePreviewSize">{formatSize(normalizedOptions.afterSize)}</span>}
        {(normalizedOptions.truncated || parsed.truncated) && <span className="filePreviewType">{t("results.truncated")}</span>}
      </div>
      <div className="diffContent">{parsed.lines.map(renderDiffLine)}</div>
      {(normalizedOptions.truncated || parsed.truncated) && <div className="filePreviewNotice">{t("results.truncatedDiffNotice")}</div>}
    </div>
  );
}

export function renderPlainResult(result: string, status: string) {
  const isError = status === "error";
  return (
    <details className="toolCallResult" open={isError}>
      <summary>{isError ? t("tools.error") : t("results.result")}</summary>
      <pre className={isError ? "errorText" : ""}>{truncate(result, 1000)}</pre>
    </details>
  );
}

function describeRequestedNames(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  const names = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, 6)
    .map((entry) => entry.trim());
  return names.length > 0 ? ` :: ${names.join(", ")}` : "";
}

function describeLineRange(args: Record<string, unknown>): string {
  const offset = toPositiveCount(args.offset);
  const limit = toPositiveCount(args.limit);
  if (offset !== undefined && limit !== undefined) {
    return ` :: lines ${offset}-${offset + limit - 1}`;
  }
  if (offset !== undefined) {
    return ` :: from line ${offset}`;
  }
  return limit !== undefined ? ` :: first ${limit} lines` : "";
}

function toPositiveCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function formatRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === ".") {
    return "./";
  }
  if (normalized === ".." || normalized.split("/").includes("..") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    return "[invalid workspace path]";
  }
  return normalized.startsWith("./") ? normalized : `./${normalized}`;
}

function parseArguments(argumentsJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getPreviewContent(toolName: string, args: Record<string, unknown>): string | undefined {
  const content = args.content;
  if (typeof content === "string") {
    return content;
  }

  const replace = args.replace;
  if (toolName === "edit_file" && typeof replace === "string") {
    return replace;
  }

  const command = args.command;
  if (typeof command === "string") {
    return command;
  }

  const query = args.query;
  if (typeof query === "string") {
    return query;
  }

  return undefined;
}

function renderBinaryHeader(filename: string, size: number, message: string) {
  return (
    <div className="filePreview binaryPreview">
      <div className="filePreviewHeader">
        <span className="filePreviewName">{filename}</span>
        <span className="filePreviewSize">{formatSize(size)}</span>
        <span className="filePreviewType">{t("results.binary")}</span>
      </div>
      <div className="filePreviewNotice">{message}</div>
    </div>
  );
}

function renderCodePreview(options: { filename: string; language?: string; size: number; previewSize?: number; content: string; truncated?: boolean; showMetadata?: boolean }) {
  const { filename, language, size, previewSize, content, truncated, showMetadata = true } = options;
  return (
    <div className="filePreview codePreview">
      <div className="filePreviewHeader">
        <span className="filePreviewName">{filename}</span>
        {showMetadata && language && <span className="filePreviewLang">{language}</span>}
        {showMetadata && <span className="filePreviewSize">{formatSize(size)}</span>}
        {truncated && <span className="filePreviewType">preview {formatSize(previewSize || content.length)}</span>}
        {truncated && <span className="filePreviewType">{t("results.truncated")}</span>}
      </div>
      <pre className="filePreviewCode">
        <code className={`language-${language || "text"}`}>{renderHighlightedCode(content, language)}</code>
      </pre>
      {truncated && <div className="filePreviewNotice">{t("results.onlyTheFirstSizeIsShown", { size: formatSize(previewSize || content.length) })}</div>}
    </div>
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.substring(0, maxLength)}...\n[truncated, ${value.length} chars]` : value;
}

function renderHighlightedCode(code: string, language?: string) {
  return <>{code.split("\n").map((line, index) => renderHighlightedLine(line, index, language))}</>;
}

function renderHighlightedLine(line: string, index: number, language?: string) {
  const tokens = tokenizeLine(line, language);
  return (
    <span key={index} className="codeLine">
      {tokens.map((token, tokenIndex) => (
        <span key={tokenIndex} className={token.className}>
          {token.text}
        </span>
      ))}
      {"\n"}
    </span>
  );
}

function tokenizeLine(line: string, language?: string): Array<{ text: string; className?: string }> {
  if (!language) {return [{ text: line }];}
  const pattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|async|await|try|catch|new|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\/\/.*$|#.*$)/g;
  const tokens: Array<{ text: string; className?: string }> = [];
  let cursor = 0;

  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) {continue;}
    if (match.index > cursor) {tokens.push({ text: line.slice(cursor, match.index) });}
    tokens.push({ text: match[0], className: getTokenClass(match[0]) });
    cursor = match.index + match[0].length;
  }

  if (cursor < line.length) {tokens.push({ text: line.slice(cursor) });}
  return tokens;
}

function getTokenClass(token: string): string {
  if (token.startsWith("//") || token.startsWith("#")) {return "syntaxComment";}
  if (/^["'`]/.test(token)) {return "syntaxString";}
  if (/^\d/.test(token)) {return "syntaxNumber";}
  return "syntaxKeyword";
}

type ParsedDiffLine = {
  text: string;
  kind: "add" | "remove" | "header" | "hunk" | "context" | "note";
  oldLine?: number;
  newLine?: number;
};

function parseDiff(content: string): { lines: ParsedDiffLine[]; stats: DiffStats; truncated: boolean } {
  let oldLine = 0;
  let newLine = 0;
  const stats: DiffStats = { additions: 0, deletions: 0 };
  let truncated = false;

  const lines = content.split("\n").map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      return { text, kind: "hunk" as const };
    }

    if (text.startsWith("--- ") || text.startsWith("+++ ")) {
      return { text, kind: "header" as const };
    }

    if (text.startsWith("... diff truncated")) {
      truncated = true;
      return { text, kind: "note" as const };
    }

    if (text.startsWith("+")) {
      const line = { text, kind: "add" as const, newLine };
      newLine += 1;
      stats.additions += 1;
      return line;
    }

    if (text.startsWith("-")) {
      const line = { text, kind: "remove" as const, oldLine };
      oldLine += 1;
      stats.deletions += 1;
      return line;
    }

    const line = { text, kind: "context" as const, oldLine, newLine };
    oldLine += 1;
    newLine += 1;
    return line;
  });

  return { lines, stats, truncated };
}

function renderDiffLine(line: ParsedDiffLine, index: number) {
  const className = `diffLine ${getDiffLineClass(line.kind)}`;
  return (
    <div key={index} className={className}>
      <span className="diffLineNumber">{line.oldLine ?? ""}</span>
      <span className="diffLineNumber">{line.newLine ?? ""}</span>
      <span className="diffLineText">{line.text}</span>
    </div>
  );
}

function getDiffLineClass(kind: ParsedDiffLine["kind"]): string {
  if (kind === "add") {return "diffAdd";}
  if (kind === "remove") {return "diffRemove";}
  if (kind === "header") {return "diffHeader";}
  if (kind === "hunk") {return "diffHunk";}
  if (kind === "note") {return "diffNote";}
  return "diffContext";
}

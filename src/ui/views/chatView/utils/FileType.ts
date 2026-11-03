import type { ApplicationSessionResult } from "@/contracts/ApplicationSession";
import type { StructuredToolResult, TerminalCommandResult } from "./FilePreviewTypes";

export function parseStructuredToolResult(content: string): StructuredToolResult | null {
  try {
    const parsed = JSON.parse(content) as Partial<StructuredToolResult>;
    return typeof parsed.toolResultVersion === "number" && typeof parsed.type === "string" ? (parsed as StructuredToolResult) : null;
  } catch {
    return null;
  }
}

function parseTerminalCommandResult(content: string): TerminalCommandResult | null {
  try {
    const parsed = JSON.parse(content) as Partial<TerminalCommandResult>;
    return parsed.kind === "command_result"
      && typeof parsed.command === "string"
      && typeof parsed.cwd === "string"
      && typeof parsed.shell === "string"
      && typeof parsed.stdout === "string"
      && typeof parsed.stderr === "string"
      && (typeof parsed.exitCode === "number" || parsed.exitCode === null)
      && typeof parsed.durationMs === "number"
      && typeof parsed.timedOut === "boolean"
      && typeof parsed.cancelled === "boolean"
      && Boolean(parsed.truncated)
      ? parsed as TerminalCommandResult
      : null;
  } catch {
    return null;
  }
}

export function parseTerminalResult(content: string): TerminalCommandResult | ApplicationSessionResult | null {
  const command = parseTerminalCommandResult(content);
  if (command) {return command;}
  try {
    const value = JSON.parse(content) as Partial<ApplicationSessionResult> | null;
    return value?.kind === "application_session"
      && typeof value.sessionId === "string"
      && ["running", "exited", "stopped"].includes(value.status ?? "")
      && typeof value.command === "string" && typeof value.cwd === "string"
      && typeof value.stdout === "string" && typeof value.stderr === "string"
      && (typeof value.exitCode === "number" || value.exitCode === null)
      && typeof value.timedOut === "boolean"
      && typeof value.truncated?.stdout === "boolean" && typeof value.truncated?.stderr === "boolean"
      ? value as ApplicationSessionResult : null;
  } catch {return null;}
}

export function detectLanguage(filename: string): string | undefined {
  const basename = extractFilename(filename).toLowerCase();
  const filenameMap: Record<string, string> = {
    dockerfile: "dockerfile",
    makefile: "makefile",
    "package.json": "json",
    "tsconfig.json": "json",
  };
  if (filenameMap[basename]) {return filenameMap[basename];}

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    php: "php",
    vue: "vue",
    svelte: "svelte",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "fish",
  };
  return langMap[ext];
}

export function extractFilename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

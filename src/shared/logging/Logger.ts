import { redactSensitiveText } from "@/shared/security/Redaction";

export type LogLevel = "debug" | "info" | "warning" | "error";

export interface DiagnosticCorrelation {
  requestId?: string;
  conversationId?: string;
  generationId?: string;
  toolCallId?: string;
}

export interface DiagnosticSink {
  appendLine(value: string): void;
  clear?(): void;
  show?(): void;
  dispose(): void;
}

const MAX_ENTRIES = 500;
const MAX_BYTES = 256 * 1024;
let minimumLevel: LogLevel = "warning";
let sink: DiagnosticSink | undefined;
let entries: string[] = [];
let entryBytes = 0;

export function initializeLogger(nextSink: DiagnosticSink, level: LogLevel = "warning"): { dispose(): void } {
  sink?.dispose();
  sink = nextSink;
  minimumLevel = level;
  return {
    dispose: () => {
      if (sink === nextSink) {
        sink = undefined;
        nextSink.dispose();
      }
    },
  };
}

export function logInfo(message: string, detail?: unknown, correlation?: DiagnosticCorrelation): void {
  write("info", message, detail, correlation);
}

export function logWarning(message: string, detail?: unknown, correlation?: DiagnosticCorrelation): void {
  write("warning", message, detail, correlation);
}

export function logError(message: string, error?: unknown, correlation?: DiagnosticCorrelation): void {
  write("error", message, error, correlation);
}

export function clearDiagnostics(): void {
  entries = [];
  entryBytes = 0;
  sink?.clear?.();
}

export function showDiagnostics(): void {
  sink?.show?.();
}

export function createSanitizedSupportReport(metadata: Record<string, unknown>): string {
  return [
    "YCraSy DeepSeek Agent support report",
    JSON.stringify(sanitizeValue(metadata), null, 2),
    "",
    ...entries,
  ].join("\n");
}

export function redactDiagnostic(message: string, error?: unknown): string {
  const detail = error === undefined ? "" : `: ${JSON.stringify(sanitizeValue(error))}`;
  return `${redactSensitiveText(message)}${detail}`;
}

function write(level: LogLevel, message: string, detail?: unknown, correlation?: DiagnosticCorrelation): void {
  if (levelRank(level) < levelRank(minimumLevel)) {
    return;
  }
  const correlationText = correlation
    ? Object.entries(correlation)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
      .map(([key, value]) => `${key}=${redactSensitiveText(value)}`)
      .join(" ")
    : "";
  const line = `${new Date().toISOString()} ${level.toUpperCase()}${correlationText ? ` [${correlationText}]` : ""} ${redactDiagnostic(message, detail)}`;
  entries.push(line);
  entryBytes += byteLength(line);
  while (entries.length > MAX_ENTRIES || entryBytes > MAX_BYTES) {
    const removed = entries.shift();
    if (removed) {
      entryBytes -= byteLength(removed);
    }
  }
  sink?.appendLine(line);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[TRUNCATED]";
  }
  if (value instanceof Error) {
    return {
      name: redactSensitiveText(value.name),
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack).split("\n").slice(0, 12).join("\n") : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, nested]) => [
      key,
      /authorization|api.?key|token|secret|user.?id/i.test(key) ? "[REDACTED]" : sanitizeValue(nested, depth + 1),
    ]));
  }
  return typeof value === "string" ? redactSensitiveText(value) : value;
}

function levelRank(level: LogLevel): number {
  return { debug: 0, info: 1, warning: 2, error: 3 }[level];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

import { redactCredentials } from "./Redaction";

/** Preserve JSON and workspace paths needed by tool consumers while removing recognizable credentials. */
export function redactToolOutput(value: string): string {
  try {return JSON.stringify(redactValue(JSON.parse(value)));}
  catch {return redactCredentials(value);}
}

function redactValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return /^(?:authorization|password|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)$/i.test(key)
      ? "[REDACTED]"
      : redactCredentials(value);
  }
  if (Array.isArray(value)) {return value.map((item) => redactValue(item));}
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactValue(item, name)]));
  }
  return value;
}

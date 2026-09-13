const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;}"']+/gi,
  /((?:api[\s_-]?key|token|secret)\s*["']?\s*[:=]\s*["']?)[^"',;\s}]+/gi,
  /\b((?:api[\s_-]?key|token|secret)\s+(?:(?:is|was)\s+)?)[^\s,;}"']+/gi,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b(user[_\s-]?id\s*["']?\s*[:=]\s*["']?)[^"',;\s}]+/gi,
  /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
  /\b[A-Za-z]:\\(?:[^\s'"<>|]+\\)*[^\s'"<>|]*/g,
  /file:\/\/\/[^\s'"<>]+/gi,
  /(^|[\s'"(])\/(?:Users|home|tmp|var|private|workspace)\/[^\s'"<>)]*/g,
];

export function redactSensitiveText(value: unknown, sensitiveValues: readonly string[] = []): string {
  let redacted = value instanceof Error ? value.message : String(value);
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) {
      redacted = redacted.split(sensitiveValue).join("[REDACTED]");
    }
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, prefix?: string) => `${prefix && !/^https?:/i.test(prefix) ? prefix : ""}[REDACTED]`);
  }
  return redacted;
}

/** Credential patterns only: tool results must retain usable filesystem paths. */
export function redactCredentials(value: string): string {
  let redacted = value;
  for (const pattern of SENSITIVE_PATTERNS.slice(0, 6)) {
    redacted = redacted.replace(pattern, (_match, prefix?: string) => `${prefix && !/^https?:/i.test(prefix) ? prefix : ""}[REDACTED]`);
  }
  return redacted.replace(/\b(password\s*[:=]\s*)[^\s,;}"']+/gi, "$1[REDACTED]");
}

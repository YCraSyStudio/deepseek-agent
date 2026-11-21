/** Base name only: the Markdown extension is appended separately and cannot be changed. */
export function isInstructionName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value);
}

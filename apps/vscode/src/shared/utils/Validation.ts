export function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

export function isNonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return isBoundedString(value, maxLength) && value.trim().length > 0;
}

export function isOptionalBoundedString(value: unknown, maxLength: number): boolean {
  return value === undefined || isBoundedString(value, maxLength);
}

export function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

export function isOptionalNumberInRange(value: unknown, min: number, max: number): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
}

export function isEnumOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

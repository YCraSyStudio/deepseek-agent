import { isRecord } from "@/shared/utils/TypeGuards";

/** Completeness counts populated values, then their content; it does not imply correctness. */
function completeness(value: unknown): number {
  if (value === null || value === undefined || value === "") {return 0;}
  if (Array.isArray(value)) {return value.reduce<number>((sum, item) => sum + completeness(item), 0);}
  if (isRecord(value)) {return Object.values(value).reduce<number>((sum, item) => sum + completeness(item), 0);}
  return 1 + (typeof value === "string" ? Math.min(value.trim().length, 1000) / 1001 : 0);
}

export function mergeLegacyJson(legacy: unknown, current: unknown): { value: unknown; conflicts: string[] } {
  const preferLegacy = completeness(legacy) > completeness(current);
  const conflicts: string[] = [];
  function merge(old: unknown, next: unknown, field: string): unknown {
    if (JSON.stringify(old) === JSON.stringify(next)) {return next;}
    if (completeness(old) === 0) {return next;}
    if (completeness(next) === 0) {return old;}
    if (isRecord(old) && isRecord(next)) {
      for (const key of ["id", "schemaVersion"]) {
        if (key in old && key in next && old[key] !== next[key]) {
          conflicts.push(`${field}.${key}`);
          return preferLegacy ? old : next;
        }
      }
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        result[key] = !(key in old) ? next[key] : !(key in next) ? old[key] : merge(old[key], next[key], `${field}.${key}`);
      }
      return result;
    }
    if (Array.isArray(old) && Array.isArray(next)) {
      if ([...old, ...next].every(item => !item || typeof item !== "object")) {
        return [...new Map([...old, ...next].map(item => [JSON.stringify(item), item])).values()];
      }
      if ([...old, ...next].every(item => isRecord(item) && typeof item.id === "string")) {
        const merged = new Map<string, unknown>();
        const first = preferLegacy ? old : next;
        const second = preferLegacy ? next : old;
        for (const item of first) {merged.set(item.id as string, item);}
        for (const item of second) {
          const existing = merged.get(item.id as string);
          merged.set(item.id as string, existing === undefined ? item : preferLegacy
            ? merge(existing, item, `${field}[${item.id}]`) : merge(item, existing, `${field}[${item.id}]`));
        }
        return [...merged.values()];
      }
    }
    conflicts.push(field);
    return preferLegacy ? old : next;
  }
  return { value: merge(legacy, current, "$"), conflicts };
}

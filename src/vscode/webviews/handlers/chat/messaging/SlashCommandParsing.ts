import type { PermissionMode } from "@/contracts";

export interface ParsedSlashCommand {
  name: string;
  args: string[];
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [rawName, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  return { name: (rawName || "").toLowerCase(), args };
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "default" || value === "auto-approve" || value === "full-access";
}

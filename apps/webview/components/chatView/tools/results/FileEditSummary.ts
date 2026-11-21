import type { ToolCallGroup } from "@webview/views/chatView/ChatViewTypes";
import { getToolCallFileChange } from "./FileToolPresentation";

const MAX_TURN_FILES = 50;

export interface TurnFileEdit {
  path: string;
  additions: number;
  deletions: number;
  diff?: string;
  beforeHash?: string;
  afterHash?: string;
}

export function collectTurnFileEdits(groups: readonly ToolCallGroup[]): TurnFileEdit[] {
  const edits = new Map<string, TurnFileEdit>();

  for (const group of groups) {
    for (const toolCall of group.toolCalls) {
      const change = getToolCallFileChange(toolCall);
      if (!change) {
        continue;
      }

      const existing = edits.get(change.path);
      if (existing) {
        existing.additions += change.stats?.additions ?? 0;
        existing.deletions += change.stats?.deletions ?? 0;
        existing.diff = change.diff ?? existing.diff;
        existing.beforeHash = change.beforeHash ?? existing.beforeHash;
        existing.afterHash = change.afterHash ?? existing.afterHash;
        continue;
      }

      if (edits.size >= MAX_TURN_FILES) {
        continue;
      }
      edits.set(change.path, {
        path: change.path,
        additions: change.stats?.additions ?? 0,
        deletions: change.stats?.deletions ?? 0,
        diff: change.diff,
        beforeHash: change.beforeHash,
        afterHash: change.afterHash,
      });
    }
  }

  return [...edits.values()];
}

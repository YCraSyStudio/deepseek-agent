import type { ToolCall } from "@/contracts";
import type { StoredExecution } from "./Types";

const MUTATING_FILE_TOOLS = new Set(["create_file", "edit_file", "apply_patch", "move_path", "delete_path"]);

interface PathFailureState {
  failures: number;
  requiresRead: boolean;
  blocked: boolean;
}

export class MutationFailureGuard {
  private readonly states = new Map<string, PathFailureState>();

  getBlockReason(toolCall: ToolCall): string | undefined {
    if (!MUTATING_FILE_TOOLS.has(toolCall.function.name)) {return undefined;}
    const path = getNormalizedPath(toolCall);
    if (!path) {return undefined;}
    const state = this.states.get(path);
    if (state?.blocked) {
      return `Skipped: two mutation attempts already failed for "${path}" in this generation. Do not mutate this path again; report the blocker to the user.`;
    }
    if (state?.requiresRead) {
      return `Skipped: the previous mutation failed for "${path}". Read the file successfully before making the single allowed retry.`;
    }
    return undefined;
  }

  record(toolCall: ToolCall, execution: StoredExecution | undefined): void {
    const path = getNormalizedPath(toolCall);
    if (!path || !execution) {return;}

    if (toolCall.function.name === "read_file" && execution.status === "completed") {
      const state = this.states.get(path);
      if (state && !state.blocked) {state.requiresRead = false;}
      return;
    }
    if (!MUTATING_FILE_TOOLS.has(toolCall.function.name)) {return;}

    if (execution.status === "completed") {
      this.states.delete(path);
      return;
    }
    if (execution.status !== "error") {return;}

    const state = this.states.get(path) ?? { failures: 0, requiresRead: false, blocked: false };
    state.failures += 1;
    state.requiresRead = state.failures < 2;
    state.blocked = state.failures >= 2;
    this.states.set(path, state);
  }
}

function getNormalizedPath(toolCall: ToolCall): string | undefined {
  if (toolCall.function.name !== "read_file" && !MUTATING_FILE_TOOLS.has(toolCall.function.name)) {return undefined;}
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    if (typeof args.path !== "string" || !args.path.trim()) {return undefined;}
    const normalized = args.path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  } catch {
    return undefined;
  }
}

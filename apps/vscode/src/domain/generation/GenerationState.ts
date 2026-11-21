export type GenerationStatus =
  | "starting"
  | "compacting"
  | "streaming"
  | "awaiting_confirmation"
  | "running_tool"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "completed"
  | "error";

const TERMINAL_STATES: ReadonlySet<GenerationStatus> = new Set(["cancelled", "interrupted", "completed", "error"]);

const ALLOWED_TRANSITIONS: Readonly<Record<GenerationStatus, ReadonlySet<GenerationStatus>>> = {
  starting: new Set(["starting", "compacting", "streaming", "cancelling", "interrupted", "error"]),
  compacting: new Set(["compacting", "streaming", "cancelling", "interrupted", "error"]),
  streaming: new Set(["streaming", "awaiting_confirmation", "running_tool", "cancelling", "interrupted", "completed", "error"]),
  awaiting_confirmation: new Set(["awaiting_confirmation", "running_tool", "streaming", "cancelling", "interrupted", "error"]),
  running_tool: new Set(["running_tool", "awaiting_confirmation", "streaming", "cancelling", "interrupted", "completed", "error"]),
  cancelling: new Set(["cancelling", "cancelled"]),
  cancelled: new Set(["cancelled"]),
  interrupted: new Set(["interrupted"]),
  completed: new Set(["completed"]),
  error: new Set(["error"]),
};

export function transitionGenerationState(
  current: GenerationStatus,
  next: GenerationStatus,
): GenerationStatus {
  if (!ALLOWED_TRANSITIONS[current].has(next)) {
    throw new Error(`Invalid generation state transition: ${current} -> ${next}`);
  }
  return next;
}

export function isTerminalGenerationState(status: GenerationStatus): boolean {
  return TERMINAL_STATES.has(status);
}

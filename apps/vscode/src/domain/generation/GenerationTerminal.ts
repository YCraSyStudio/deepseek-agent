export interface GenerationTerminalState {
  generationId: string;
  conversationId: string;
  pendingTerminalEvent?: Record<string, unknown>;
  terminalEventSent?: boolean;
}

export function captureGenerationTerminal(
  state: GenerationTerminalState,
  event: Record<string, unknown>,
): void {
  if (!state.terminalEventSent) {
    state.pendingTerminalEvent = event;
  }
}

export function finalizeGenerationTerminal(
  state: GenerationTerminalState,
  fallback: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (state.terminalEventSent) {
    return undefined;
  }
  const message = {
    ...(state.pendingTerminalEvent ?? {}),
    ...fallback,
    generationId: state.generationId,
    conversationId: state.conversationId,
  };
  state.terminalEventSent = true;
  state.pendingTerminalEvent = undefined;
  return message;
}

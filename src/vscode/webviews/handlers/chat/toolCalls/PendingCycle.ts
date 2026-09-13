import type { ToolCall } from "@/contracts";
import type { PendingToolCallCycle, ToolCallAction } from "./Types";

export function createPendingToolCallCycle(toolCalls: ToolCall[], round: number): PendingToolCallCycle {
  const individualResolves = new Map<string, (action: ToolCallAction) => void>();
  const individualPromises = new Map<string, Promise<ToolCallAction>>();
  const resolved = new Set<string>();

  for (const toolCall of toolCalls) {
    const promise = new Promise<ToolCallAction>((resolve) => {
      individualResolves.set(toolCall.id, (action) => {
        if (resolved.has(toolCall.id)) {
          return;
        }

        resolved.add(toolCall.id);
        resolve(action);
      });
    });
    individualPromises.set(toolCall.id, promise);
  }

  return {
    toolCalls: new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall])),
    round,
    individualResolves,
    individualPromises,
    resolved,
  };
}

export function resolveToolCallAction(cycle: PendingToolCallCycle, toolCallId: string, action: ToolCallAction): "resolved" | "missing" | "duplicate" {
  const individualResolve = cycle.individualResolves.get(toolCallId);
  if (!individualResolve) {
    return "missing";
  }

  if (cycle.resolved.has(toolCallId)) {
    return "duplicate";
  }

  individualResolve(action);
  return "resolved";
}

export function cancelPendingToolCallCycle(cycle: PendingToolCallCycle): void {
  for (const toolCallId of cycle.toolCalls.keys()) {
    if (!cycle.resolved.has(toolCallId)) {
      cycle.individualResolves.get(toolCallId)?.("reject");
      cycle.resolved.add(toolCallId);
    }
  }
}

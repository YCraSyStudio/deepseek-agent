import type { ToolCall } from "@/contracts";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import type { DangerConfirmationDecision, PendingDangerConfirmation } from "./Types";
import type { GenerationEventSink } from "@/application/ports";

interface DangerConfirmationOptions {
  eventSink: GenerationEventSink<Record<string, unknown>>;
  toolCall: ToolCall;
  confirmationResult: ConfirmationRequiredResult;
  setPendingDangerConfirmation: (value: PendingDangerConfirmation | null) => void;
  announceStarted?: boolean;
  round?: number;
}

export async function requestDangerConfirmation(options: DangerConfirmationOptions): Promise<DangerConfirmationDecision> {
  const { eventSink, toolCall, confirmationResult, setPendingDangerConfirmation, announceStarted = false, round = 0 } = options;

  const decision = await new Promise<DangerConfirmationDecision>((resolve) => {
    setPendingDangerConfirmation({ toolCall, resolve, confirmationResult });

    if (announceStarted) {
      void eventSink.publish({
        type: "toolCallStarted",
        toolCalls: [toolCall],
        round,
      });
    }

    void eventSink.publish({
      type: "toolCallConfirmationRequired",
      toolCalls: [toolCall],
      round,
      autoExecute: false,
      dangerConfirmation: confirmationResult,
    });
  });

  setPendingDangerConfirmation(null);
  return decision;
}

import type { StoredConversation } from "./ProviderTranscript";

export interface SteeringContinuation {
  sourceGenerationId: string;
}

export function buildSteeringContinuationInstruction(
  steering: SteeringContinuation | undefined,
  conversation: StoredConversation | undefined,
): string | undefined {
  if (!steering || !conversation) {return undefined;}
  const sourceMessages = conversation.messages.filter(
    (message) => message.generationId === steering.sourceGenerationId,
  );
  const sourceWasSteered = sourceMessages.some(
    (message) => message.role === "assistant" && message.generationStopReason === "steered",
  );
  const hasOriginalRequest = sourceMessages.some((message) => message.role === "user");
  if (!sourceWasSteered || !hasOriginalRequest) {return undefined;}

  return [
    "<live-steering>",
    "The latest user message is live guidance for the immediately preceding interrupted generation, not an unrelated new task.",
    "Continue the original request and adapt the remaining work immediately to that guidance. The latest guidance wins where it conflicts with the earlier request.",
    "Reuse completed results, do not repeat successful side effects, and do not mention the internal interruption or restart unless it materially prevents completion.",
    "</live-steering>",
  ].join("\n");
}

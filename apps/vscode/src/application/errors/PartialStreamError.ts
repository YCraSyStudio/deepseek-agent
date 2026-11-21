import type { AssistantTimelineEvent } from "@/contracts";
import type { ProviderUsage } from "@/shared/usage/Usage";

export interface StreamedAssistantResult {
  content: string;
  reasoning: string;
  timeline: AssistantTimelineEvent[];
  usage?: ProviderUsage;
}

export class PartialStreamError extends Error {
  constructor(
    message: string,
    readonly partial: StreamedAssistantResult,
    readonly reason: "cancelled" | "failed" = "failed",
  ) {
    super(message);
    this.name = "PartialStreamError";
  }
}

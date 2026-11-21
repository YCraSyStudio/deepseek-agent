import type { ChatMessage } from "@/contracts";
import { getTextContent } from "@/contracts/deepseek/Chat";
import type { ProgressReviewResult } from "./ToolCallTypes";

const PROGRESS_CHECKPOINT_MARKER = "<progress_review_checkpoint";
const COMPLETION_RECOVERY_MARKER = "<completion_recovery";
const GUIDANCE_MARKERS = [PROGRESS_CHECKPOINT_MARKER, COMPLETION_RECOVERY_MARKER];

export function createProgressReviewCheckpointMessage(
  review: ProgressReviewResult,
  completedRounds: number,
): ChatMessage {
  const evidence = JSON.stringify({
    decision: review.decision,
    confidence: review.confidence,
    reason: sanitizeReviewText(review.reason),
    ...(review.nextAction ? { nextAction: sanitizeReviewText(review.nextAction) } : {}),
  });
  const content =
    `${PROGRESS_CHECKPOINT_MARKER} completed_rounds="${completedRounds}">` +
    "Internal turn guidance, not a new user request; it supersedes any earlier progress checkpoint. " +
    `An independent progress reviewer assessed the completed work: ${evidence}. ` +
    "Reassess the user's goal before the next tool call. Treat the bounded next action as the priority for the next block. Finish missing primary deliverables before deepening verification of an already working component, and do not repeat successful builds, tests, reads, endpoint matrices, or cleanup. " +
    progressReviewGuidance(review) +
    "</progress_review_checkpoint>";
  return { role: "user", content };
}

export function createCompletionRecoveryMessage(): ChatMessage {
  return {
    role: "user",
    content: `${COMPLETION_RECOVERY_MARKER}>The previous response stopped after announcing an action without performing it. Continue the same turn now. Either issue the necessary tool call or provide the complete final answer in the language of the user's latest message. Do not announce another future action.</completion_recovery>`,
  };
}

export function isTurnGuidanceMessage(message: Pick<ChatMessage, "role" | "content">): boolean {
  if (message.role !== "user") {return false;}
  const content = getTextContent(message.content).trimStart();
  return GUIDANCE_MARKERS.some((marker) => content.startsWith(marker));
}

function progressReviewGuidance(review: ProgressReviewResult): string {
  if (review.decision === "blocked") {
    return "The reviewer believes further work is blocked. Prefer a final response that summarizes completed work and asks only for the missing information or authorization. Use another tool only if the reviewer overlooked a concrete action that can actually remove the blocker. ";
  }
  if (review.decision === "finalize") {
    return review.confidence === "high"
      ? "The reviewer determined that the requested work is complete and remaining checks are unnecessary. Stop using tools now. Do not continue tests, cleanup, or optional verification; provide the concise final summary in this response. "
      : "The reviewer believes the goal is complete. Prefer the final response now and avoid optional verification. Use another tool only when a concrete primary deliverable is demonstrably still missing. ";
  }
  return "If the goal is already complete or remaining work is optional, stop using tools and provide the final response. ";
}

function sanitizeReviewText(value: string): string {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 1_000);
}

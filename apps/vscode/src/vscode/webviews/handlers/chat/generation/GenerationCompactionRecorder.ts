import { createHash, randomUUID } from "crypto";
import { ConversationState } from "@/application/chat/ConversationState";

interface RecordToolCycleCompactionOptions {
  state: ConversationState;
  generationId: string;
  model: string;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  syncSelectedConversation: (state: ConversationState) => void;
}

export async function recordToolCycleCompaction({
  state,
  generationId,
  model,
  estimatedTokensBefore,
  estimatedTokensAfter,
  syncSelectedConversation,
}: RecordToolCycleCompactionOptions): Promise<void> {
  const previous = state.getConversation()?.contextSummary;
  const now = Date.now();
  const sourceDigest = createHash("sha256")
    .update(`${generationId}:${estimatedTokensBefore}:${estimatedTokensAfter}`)
    .digest("hex");

  await state.saveContextSummary({
    schemaVersion: 2,
    provider: previous?.provider ?? "local",
    content: previous?.content ?? "",
    coveredGenerationIds: previous?.coveredGenerationIds ?? [],
    sourceDigest: previous?.sourceDigest ?? sourceDigest,
    updatedAt: now,
    boundaries: [
      ...(previous?.boundaries ?? []),
      {
        id: randomUUID(),
        createdAt: now,
        reason: "tool_cycle_rollover" as const,
        estimatedTokensBefore,
        estimatedTokensAfter,
        coveredGenerationIds: [],
        sourceDigest,
      },
    ].slice(-1_000),
  });
  await state.saveMessages({
    messages: [state.createMessage("context", "Context automatically compacted", { generationId })],
    model,
  });
  syncSelectedConversation(state);
}

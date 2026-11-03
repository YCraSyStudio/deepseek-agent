import * as assert from "node:assert";
import { buildSteeringContinuationInstruction } from "@/application/chat/SteeringContinuation";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";

suite("steering continuation", () => {
  test("turns a verified steered generation into explicit continuation guidance", () => {
    const instruction = buildSteeringContinuationInstruction(
      { sourceGenerationId: "generation-1" },
      conversation("steered"),
    );

    assert.match(instruction ?? "", /live guidance/);
    assert.match(instruction ?? "", /Continue the original request/);
    assert.match(instruction ?? "", /latest guidance wins/i);
  });

  test("ignores stale or non-steered continuation metadata", () => {
    assert.strictEqual(
      buildSteeringContinuationInstruction({ sourceGenerationId: "missing" }, conversation("steered")),
      undefined,
    );
    assert.strictEqual(
      buildSteeringContinuationInstruction({ sourceGenerationId: "generation-1" }, conversation("user_cancelled")),
      undefined,
    );
  });
});

function conversation(stopReason: "steered" | "user_cancelled"): StoredConversation {
  return {
    schemaVersion: 2,
    id: "conversation-1",
    title: "Steering",
    createdAt: 1,
    updatedAt: 2,
    model: "deepseek-flash",
    workspaceUri: "file:///workspace",
    workspaceBinding: {
      schemaVersion: 1,
      uri: "file:///workspace",
      name: "workspace",
      revision: "revision-1",
      folders: [],
      capabilities: { files: true, search: true, git: true, terminal: true },
    },
    messages: [
      { id: "user-1", role: "user", content: "Original request", generationId: "generation-1" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Partial work",
        generationId: "generation-1",
        generationStatus: stopReason === "steered" ? "interrupted" : "cancelled",
        generationStopReason: stopReason,
      },
    ],
  };
}

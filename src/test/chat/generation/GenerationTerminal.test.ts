import * as assert from "node:assert";
import {
  captureGenerationTerminal,
  finalizeGenerationTerminal,
  type GenerationTerminalState,
} from "@/domain/generation/GenerationTerminal";

suite("generation terminal publication", () => {
  test("publishes exactly one correlated terminal after duplicate lower-level completion", () => {
    const record = {
      generationId: "generation-a",
      conversationId: "conversation-a",
    } satisfies GenerationTerminalState;

    captureGenerationTerminal(record, { type: "streamDone", finish_reason: "stop" });
    captureGenerationTerminal(record, { type: "streamDone", finish_reason: "stop" });
    const first = finalizeGenerationTerminal(record, { type: "streamDone" });
    const second = finalizeGenerationTerminal(record, { type: "streamDone" });

    assert.strictEqual(second, undefined);
    assert.deepStrictEqual(first, {
      type: "streamDone",
      finish_reason: "stop",
      generationId: "generation-a",
      conversationId: "conversation-a",
    });
  });
});

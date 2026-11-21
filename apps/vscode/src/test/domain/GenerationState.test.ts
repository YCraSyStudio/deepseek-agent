import * as assert from "node:assert";
import {
  isTerminalGenerationState,
  transitionGenerationState,
} from "@/domain/generation/GenerationState";

suite("generation state machine", () => {
  test("accepts the normal streaming and tool lifecycle", () => {
    let state = transitionGenerationState("starting", "compacting");
    state = transitionGenerationState(state, "streaming");
    state = transitionGenerationState(state, "awaiting_confirmation");
    state = transitionGenerationState(state, "running_tool");
    state = transitionGenerationState(state, "streaming");
    state = transitionGenerationState(state, "completed");
    assert.strictEqual(state, "completed");
    assert.strictEqual(isTerminalGenerationState(state), true);
  });

  test("rejects transitions out of terminal states", () => {
    assert.throws(
      () => transitionGenerationState("completed", "streaming"),
      /Invalid generation state transition/,
    );
  });

  test("models explicit cancellation without falling through interrupted or error", () => {
    let state = transitionGenerationState("streaming", "cancelling");
    assert.throws(
      () => transitionGenerationState(state, "interrupted"),
      /Invalid generation state transition/,
    );
    assert.throws(
      () => transitionGenerationState(state, "error"),
      /Invalid generation state transition/,
    );
    state = transitionGenerationState(state, "cancelled");
    assert.strictEqual(isTerminalGenerationState(state), true);
  });
});

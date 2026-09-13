import * as assert from "node:assert";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import { positiveDecisionCache } from "@/infrastructure/tools/safety/DecisionCache";
import {
  executeForcedAfterTrust,
  rejectCommandForRevision,
  rememberPositiveDecision,
  reviewDangerousCommandFailClosed,
} from "@/vscode/webviews/handlers/chat/toolCalls/execution/DangerPolicy";
import { recordInitialToolCall } from "@/vscode/webviews/handlers/chat/toolCalls/execution/ToolCallLedger";
import { createExecutionContext, createToolExecutorStub, toolCall } from "./executionHarness";

const confirmation: ConfirmationRequiredResult = {
  requiresConfirmation: true,
  dangerLevel: "caution",
  warningMessage: "Review required",
  command: "npm test",
};

suite("tool danger policy", () => {
  test("fails closed when the remote review is unavailable", async () => {
    const { context, reviews } = createExecutionContext({
      review: () => {
        throw new Error("reviewer offline");
      },
    });

    const review = await reviewDangerousCommandFailClosed(toolCall("run_terminal_command"), confirmation, context);

    assert.deepStrictEqual(review, {
      decision: "manual_confirmation",
      risk: "critical",
      confidence: "very_low",
      reason: "DeepSeek safety review failed, so manual confirmation is required.",
    });
    assert.strictEqual(reviews(), 1);
  });

  test("returns a compact revision result and keeps the explanation in the UI event", () => {
    const { context, publishedResults } = createExecutionContext();

    const result = rejectCommandForRevision(toolCall("run_terminal_command"), "elevated action", context);

    assert.deepStrictEqual(JSON.parse(result), { code: "security_review_revise", constraint: "elevated action" });
    assert.match(publishedResults[0] ?? "", /^Security reviewer rejected this command\./);
    assert.ok(!(publishedResults[0] ?? "").includes('"code"'));
  });

  test("forces a trusted call with the expected hash and marks it confirmed", async () => {
    const { executor, forcedCalls } = createToolExecutorStub({ forcedResult: "applied" });
    const { context, publishedResults } = createExecutionContext({ executor });
    const call = toolCall("edit_file", { path: "src/app.ts", search: "a", replace: "b" });
    recordInitialToolCall(call, context);

    const result = await executeForcedAfterTrust(call, context, { ...confirmation, beforeHash: "before-hash" });

    assert.strictEqual(result, "applied");
    assert.deepStrictEqual(publishedResults, ["applied"]);
    assert.strictEqual(forcedCalls.length, 1);
    assert.strictEqual(JSON.parse(forcedCalls[0]!.function.arguments).expectedBeforeHash, "before-hash");
    assert.strictEqual(call.function.arguments.includes("expectedBeforeHash"), false);
    assert.strictEqual(context.executedToolCalls.get(call.id)?.dangerConfirmed, true);
  });

  test("forces a call without a hash when none was recorded", async () => {
    const { executor, forcedCalls } = createToolExecutorStub();
    const { context } = createExecutionContext({ executor });

    await executeForcedAfterTrust(toolCall("run_terminal_command"), context, confirmation);

    assert.strictEqual(forcedCalls[0]!.function.arguments.includes("expectedBeforeHash"), false);
  });

  test("remembers a positive decision only when a key exists", () => {
    rememberPositiveDecision("conversation:test:workspace:test:decision");
    assert.strictEqual(positiveDecisionCache.has("conversation:test:workspace:test:decision"), true);

    assert.doesNotThrow(() => rememberPositiveDecision(undefined));
  });
});

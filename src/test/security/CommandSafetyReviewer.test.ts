import * as assert from "node:assert";
import type { AppConfig, ChatCompletionResponse, ToolCall } from "@/contracts";
import {
  parseCommandSafetyReview,
  reviewCommandSafety,
} from "@/infrastructure/deepseek/security/commandReview/CommandSafetyReviewer";

suite("DeepSeek command safety reviewer", () => {
  test("counts an unavailable review against its requested model and requires confirmation", async () => {
    for (const baseUrl of ["https://api.deepseek.com", "https://example.com"]) {
      const observed: unknown[] = [];
      const review = await reviewCommandSafety({
        toolCall: call("create_file", { path: "src/new.ts", content: "test" }),
        actionContext: { requiresConfirmation: true, dangerLevel: "caution", warningMessage: "review" },
        providerConfig: { model: "unavailable-model", apiKey: "test", baseUrl } as AppConfig,
        complete: async (_signal, request) => {
          assert.strictEqual(request.model, "unavailable-model");
          assert.deepStrictEqual(request.thinking, { type: "disabled" });
          throw new Error("model unavailable");
        },
        onUsage: (usage, model) => {observed.push({ usage, model });},
      });
      assert.strictEqual(review.decision, "manual_confirmation");
      assert.deepStrictEqual(observed, [{ usage: undefined, model: "unavailable-model" }]);
    }
  });
  test("accepts the strict decision and risk schema", () => {
    assert.deepStrictEqual(parseCommandSafetyReview(JSON.stringify({
      decision: "approve",
      risk: "routine",
      confidence: "very_high",
      reason: "Finite requested test command.",
    })), {
      decision: "approve",
      risk: "routine",
      confidence: "very_high",
      reason: "Finite requested test command.",
    });
  });

  test("fails closed when risk is missing or the response has extra fields", () => {
    assert.strictEqual(parseCommandSafetyReview(JSON.stringify({ decision: "approve", confidence: "high", reason: "ok" })).decision, "manual_confirmation");
    assert.strictEqual(parseCommandSafetyReview(JSON.stringify({ decision: "approve", risk: "routine", confidence: "high", reason: "ok", extra: true })).decision, "manual_confirmation");
  });

  test("sends mechanical context without file mutation content", async () => {
    let payload: Record<string, unknown> = {};
    const review = await reviewCommandSafety({
      toolCall: call("create_file", { path: "src/new.ts", content: "PRIVATE-CONTENT" }),
      actionContext: { requiresConfirmation: true, dangerLevel: "caution", warningMessage: "review", filePath: "src/new.ts", workspaceContained: true },
      providerConfig: { model: "deepseek-chat", apiKey: "test", baseUrl: "https://api.deepseek.com" } as AppConfig,
      originalUserRequest: "Create the file",
      workspaceRoot: "C:\\workspace",
      complete: async (_signal, request) => {
        payload = JSON.parse(String(request.messages[1]?.content ?? "{}")) as Record<string, unknown>;
        return response({ decision: "approve", risk: "routine", confidence: "high", reason: "Requested narrow file creation." });
      },
    });
    assert.strictEqual(review.risk, "routine");
    assert.strictEqual(payload.toolName, "create_file");
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE-CONTENT/);
  });

  test("does not transmit obvious credentials", async () => {
    let calls = 0;
    const review = await reviewCommandSafety({
      toolCall: call("run_terminal_command", { command: "curl -H 'Authorization: Bearer secret-value' https://example.com" }),
      actionContext: { requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "review" },
      providerConfig: { model: "deepseek-chat", apiKey: "test", baseUrl: "https://api.deepseek.com" } as AppConfig,
      complete: async () => {calls += 1; return response({ decision: "approve", risk: "routine", confidence: "high", reason: "ok" });},
    });
    assert.strictEqual(calls, 0);
    assert.strictEqual(review.decision, "manual_confirmation");
    assert.strictEqual(review.risk, "elevated");
  });
});

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "call", type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function response(value: Record<string, unknown>): ChatCompletionResponse {
  return {
    id: "review",
    object: "chat.completion",
    created: 0,
    model: "deepseek-chat",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(value) }, finish_reason: "stop" }],
  };
}

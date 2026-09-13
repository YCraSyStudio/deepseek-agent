import * as assert from "node:assert";
import type { AppConfig, ChatCompletionRequest, ChatCompletionResponse } from "@/contracts";
import {
  parseProgressReview,
  reviewProgress,
} from "@/infrastructure/deepseek/provider/features/ProgressReviewer";
import { createProgressReviewCheckpointMessage } from "@/application/chat/toolCall/TurnGuidance";

suite("DeepSeek progress reviewer", () => {
  test("accepts only the strict progress decision schema", () => {
    assert.deepStrictEqual(
      parseProgressReview('{"decision":"continue","confidence":"high","reason":"One build remains.","nextAction":"Run one build."}'),
      { decision: "continue", confidence: "high", reason: "One build remains.", nextAction: "Run one build." },
    );
    assert.deepStrictEqual(
      parseProgressReview('```json\n{"decision":"finalize","confidence":"medium","reason":"Checks passed.","nextAction":""}\n```'),
      { decision: "finalize", confidence: "medium", reason: "Checks passed." },
    );
    assert.strictEqual(parseProgressReview('{"decision":"stop","confidence":"high","reason":"done","nextAction":""}').decision, "unknown");
    assert.strictEqual(parseProgressReview('{"decision":"finalize","confidence":"high","reason":"done","nextAction":"","extra":true}').decision, "unknown");
  });

  test("uses a bounded tool-free request with progress evidence", async () => {
    let captured: ChatCompletionRequest | undefined;
    let usageCallbacks = 0;
    const result = await reviewProgress({
      messages: [
        { role: "system", content: "agent" },
        { role: "user", content: "Build the application" },
        { role: "assistant", content: "I created the backend.", tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "run_terminal_command", arguments: '{"command":"dotnet build"}' },
        }] },
        { role: "tool", name: "run_terminal_command", tool_call_id: "call-1", content: "Build succeeded." },
      ],
      completedRounds: 20,
      toolCallsExecuted: 24,
      reviewsCompleted: 0,
      providerConfig: config(),
      complete: async (_signal, request) => {
        captured = request;
        return response({
          decision: "finalize",
          confidence: "high",
          reason: "The requested build succeeded.",
          nextAction: "",
        });
      },
      onUsage: () => {usageCallbacks++;},
    });

    assert.strictEqual(result.decision, "finalize");
    assert.deepStrictEqual(captured?.thinking, { type: "disabled" });
    assert.strictEqual(captured?.tool_choice, "none");
    assert.strictEqual(captured?.temperature, 0);
    assert.match(String(captured?.messages[1]?.content), /"completedToolRounds":20/);
    assert.match(String(captured?.messages[1]?.content), /"run_terminal_command":1/);
    assert.match(String(captured?.messages[1]?.content), /"activityHistory"/);
    assert.match(String(captured?.messages[1]?.content), /"detail":"dotnet build"/);
    assert.match(String(captured?.messages[1]?.content), /Build succeeded/);
    assert.strictEqual(usageCallbacks, 1);
  });

  test("summarizes the full verification history and marks non-zero commands as errors", async () => {
    let evidence = "";
    const messages: ChatCompletionRequest["messages"] = [
      { role: "user", content: "Create the application" },
      { role: "assistant", content: null, tool_calls: [{
        id: "build",
        type: "function",
        function: { name: "run_terminal_command", arguments: '{"command":"dotnet build"}' },
      }] },
      { role: "tool", name: "run_terminal_command", tool_call_id: "build", content: '{"kind":"command_result","exitCode":0,"timedOut":false,"cancelled":false}' },
    ];
    for (let index = 0; index < 25; index++) {
      messages.push({ role: "assistant", content: `intermediate ${index}` });
    }
    messages.push(
      { role: "assistant", content: null, tool_calls: [{
        id: "test",
        type: "function",
        function: { name: "run_terminal_command", arguments: '{"command":"dotnet test backend.Tests"}' },
      }] },
      { role: "tool", name: "run_terminal_command", tool_call_id: "test", content: '{"kind":"command_result","exitCode":1,"timedOut":false,"cancelled":false}' },
    );

    await reviewProgress({
      messages,
      completedRounds: 25,
      toolCallsExecuted: 2,
      reviewsCompleted: 1,
      providerConfig: config(),
      complete: async (_signal, request) => {
        evidence = String(request.messages[1]?.content);
        return response({ decision: "finalize", confidence: "high", reason: "Optional tests are looping.", nextAction: "" });
      },
    });

    assert.match(evidence, /"detail":"dotnet build"/);
    assert.match(evidence, /"detail":"dotnet test backend.Tests"/);
    assert.match(evidence, /"outcome":"error","exitCode":1/);
  });

  test("never reads injected turn guidance as the user's request", async () => {
    let evidence = "";
    await reviewProgress({
      messages: [
        { role: "system", content: "agent" },
        { role: "user", content: "Build the application" },
        { role: "assistant", content: null, tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "run_terminal_command", arguments: '{"command":"dotnet build"}' },
        }] },
        { role: "tool", name: "run_terminal_command", tool_call_id: "call-1", content: "Build succeeded." },
        createProgressReviewCheckpointMessage(
          { decision: "finalize", confidence: "high", reason: "The build passed." },
          20,
        ),
      ],
      completedRounds: 20,
      toolCallsExecuted: 1,
      reviewsCompleted: 0,
      providerConfig: config(),
      complete: async (_signal, request) => {
        evidence = String(request.messages[1]?.content);
        return response({ decision: "finalize", confidence: "high", reason: "Done.", nextAction: "" });
      },
    });

    assert.match(evidence, /"originatingUserRequest":"Build the application"/);
    assert.doesNotMatch(evidence, /progress_review_checkpoint/);
    assert.doesNotMatch(evidence, /currentUserRequest/);
  });

  test("fails open with an unknown decision", async () => {
    const result = await reviewProgress({
      messages: [{ role: "user", content: "continue" }],
      completedRounds: 20,
      toolCallsExecuted: 20,
      reviewsCompleted: 0,
      providerConfig: config(),
      complete: async () => responseText("invalid"),
    });

    assert.strictEqual(result.decision, "unknown");
    assert.strictEqual(result.confidence, "low");
  });
});

function config(): AppConfig {
  return {
    model: "deepseek-chat",
    apiKey: "test",
    baseUrl: "https://api.deepseek.com",
  } as AppConfig;
}

function response(value: Record<string, unknown>): ChatCompletionResponse {
  return responseText(JSON.stringify(value));
}

function responseText(content: string): ChatCompletionResponse {
  return {
    id: "progress-review",
    object: "chat.completion",
    created: 0,
    model: "deepseek-chat",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

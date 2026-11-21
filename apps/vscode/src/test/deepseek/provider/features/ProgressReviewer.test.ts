import * as assert from "node:assert";
import type { AppConfig, ChatCompletionRequest, ChatCompletionResponse } from "@/contracts";
import {
  parseProgressReview,
  reviewProgress,
} from "@/infrastructure/deepseek/provider/features/ProgressReviewer";
import { createProgressReviewCheckpointMessage } from "@/application/chat/toolCall/TurnGuidance";

suite("DeepSeek progress reviewer", () => {
  for (const [label, value] of [
    ["null", null], ["array", []], ["invalid decision", { decision: "stop" }],
    ["invalid confidence", { confidence: "certain" }], ["non-string reason", { reason: 42 }],
    ["empty reason", { reason: "  " }], ["oversized reason", { reason: "r".repeat(1001) }],
    ["non-string action", { nextAction: null }], ["oversized action", { nextAction: "a".repeat(1001) }],
  ] as const) {
    test(`rejects ${label} in progress decisions`, () => {
      const valid = { decision: "continue", confidence: "high", reason: "Necessary work", nextAction: "Implement" };
      assert.strictEqual(parseProgressReview(JSON.stringify(value === null || Array.isArray(value) ? value : { ...valid, ...value })).decision, "unknown");
    });
  }
  test("handles absent, malformed and whitespace-only responses and trims valid fields", () => {
    for (const content of [undefined, null, "", "  ", "{bad"]) { assert.strictEqual(parseProgressReview(content).decision, "unknown"); }
    assert.deepStrictEqual(parseProgressReview(JSON.stringify({ decision: "blocked", confidence: "low", reason: " Missing input ", nextAction: " Ask user " })),
      { decision: "blocked", confidence: "low", reason: "Missing input", nextAction: "Ask user" });
  });

  test("summarizes tool outcome variants, malformed arguments, orphan results and updated user requests", async () => {
    const messages: ChatCompletionRequest["messages"] = [
      { role: "user", content: "Original request" }, { role: "user", content: "Updated request" },
    ];
    const outcomes: Array<[string, string, string]> = [
      ["read_file", '{"path":"src/a.ts"}', "completed"],
      ["search", '{"query":"needle"}', "Error: unavailable"],
      ["find", '{"filePattern":"*.ts"}', "Skipped: already checked"],
      ["read_file", "{bad", "Rejected by user"],
      ["read_file", '{"path":42}', "Cancelled by user"],
      ["read_file", '{"path":"  "}', '{"kind":"error","message":"failed"}'],
      ["run_terminal_command", '{"command":"test"}', '{"kind":"command_result","exitCode":null,"timedOut":true,"cancelled":false}'],
      ["run_terminal_command", '{}', '{"kind":"command_result","exitCode":"bad","timedOut":"bad","cancelled":"bad"}'],
      ["run_terminal_command", '{}', '{"kind":"command_result","exitCode":0,"cancelled":true}'],
      ["read_file", '{}', '{invalid'],
      ["read_file", '{}', '{"kind":"other"}'],
    ];
    outcomes.forEach(([name, args, content], index) => messages.push(
      { role: "assistant", content: index === 0 ? "Inspecting" : null, tool_calls: [{ id: `call-${index}`, type: "function", function: { name, arguments: args } }] },
      { role: "tool", tool_call_id: `call-${index}`, name, content },
    ));
    messages.push({ role: "tool", tool_call_id: "orphan", content: "orphan result" }, { role: "tool", content: "no ID" });
    let evidence: Record<string, unknown> = {};
    await reviewProgress({ messages, completedRounds: 20, toolCallsExecuted: 11, reviewsCompleted: 1, providerConfig: config(),
      complete: async (_signal, request) => { evidence = JSON.parse(String(request.messages[1].content)); return response({ decision: "continue", confidence: "medium", reason: "Continue", nextAction: "One action" }); } });
    assert.strictEqual(evidence.currentUserRequest, "Updated request");
    const history = evidence.activityHistory as Array<Record<string, unknown>>;
    assert.deepStrictEqual(history.map(event => event.outcome), ["completed", "error", "skipped", "rejected", "rejected", "error", "error", "error", "error", "completed", "completed", "completed"]);
    assert.deepStrictEqual(history.slice(0, 3).map(event => event.detail), ["src/a.ts", "needle", "*.ts"]);
    assert.strictEqual(history[3].detail, undefined); assert.strictEqual(history[6].exitCode, null);
    assert.strictEqual(history[7].exitCode, undefined); assert.strictEqual(history.at(-1)?.tool, "unknown");
    assert.strictEqual((evidence.recentAgentAndToolEvents as unknown[]).length, 20);
  });

  test("bounds full activity history while retaining its start and most recent outcomes", async () => {
    const messages: ChatCompletionRequest["messages"] = [];
    for (let index = 0; index < 125; index++) {
      messages.push({ role: "tool", name: `tool-${index}`, tool_call_id: String(index), content: "ok" });
    }
    let evidence: Record<string, unknown> = {};
    await reviewProgress({ messages, completedRounds: 125, toolCallsExecuted: 125, reviewsCompleted: 3, providerConfig: config(),
      complete: async (_signal, request) => { evidence = JSON.parse(String(request.messages[1].content)); return response({ decision: "finalize", confidence: "high", reason: "Done", nextAction: "" }); } });
    const history = evidence.activityHistory as Array<Record<string, unknown>>;
    assert.strictEqual(history.length, 121); assert.strictEqual(history[0].tool, "tool-0");
    assert.deepStrictEqual(history[30], { omittedActivities: 5 }); assert.strictEqual(history.at(-1)?.tool, "tool-124");
    assert.strictEqual(evidence.originatingUserRequest, "");
  });

  test("reports review failures as unknown but propagates explicit cancellation and usage once", async () => {
    for (const cancelled of [false, true]) {
      const controller = new AbortController(); const failure = new Error("review unavailable"); let callbacks = 0;
      const operation = reviewProgress({ messages: [], completedRounds: 1, toolCallsExecuted: 0, reviewsCompleted: 0,
        providerConfig: config(), signal: controller.signal, complete: async () => { if (cancelled) { controller.abort(); } throw failure; },
        onUsage: value => { assert.strictEqual(value, undefined); callbacks++; } });
      if (cancelled) { await assert.rejects(operation, error => error === failure); }
      else { assert.strictEqual((await operation).decision, "unknown"); }
      assert.strictEqual(callbacks, 1);
    }
  });

  test("uses the actual HTTP transport, respects user-ID privacy and forwards provider usage", async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const privacyMinimizeData of [true, false]) {
        let captured: Record<string, unknown> = {}; let reported: unknown;
        const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
        globalThis.fetch = async (_input, init) => {
          captured = JSON.parse(String(init?.body)); return Response.json({ ...response({ decision: "finalize", confidence: "high", reason: "Done", nextAction: "" }), usage });
        };
        const result = await reviewProgress({ messages: [], completedRounds: 1, toolCallsExecuted: 0, reviewsCompleted: 0,
          providerConfig: { ...config(), privacyMinimizeData, userId: "optional-user" }, onUsage: value => { reported = value; } });
        assert.strictEqual(result.decision, "finalize"); assert.strictEqual(captured.user_id, privacyMinimizeData ? undefined : "optional-user");
        assert.deepStrictEqual(reported, usage);
      }
    } finally { globalThis.fetch = originalFetch; }
  });

  test("propagates usage observer failures even when the review itself was available", async () => {
    const failure = new Error("usage observer failed");
    await assert.rejects(reviewProgress({ messages: [], completedRounds: 1, toolCallsExecuted: 0, reviewsCompleted: 0, providerConfig: config(),
      complete: async () => response({ decision: "finalize", confidence: "high", reason: "Done", nextAction: "" }),
      onUsage: () => { throw failure; } }), error => error === failure);
  });

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

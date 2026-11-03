import * as assert from "node:assert";
import * as path from "node:path";
import { DEFAULT_CONFIG } from "@/contracts";
import type { AppConfig, ChatCompletionResponse, ToolCall } from "@/contracts";
import {
  isAutomaticConfidence,
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
    assert.ok(!Object.hasOwn(payload, "workspaceRoot"));
    assert.ok(Object.hasOwn(payload, "scopeFacts"));
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE-CONTENT/);
  });

  test("asks the reviewer to judge keep-alive intent in natural language", async () => {
    let systemPrompt = "";
    let userPayload: Record<string, unknown> = {};
    let reply: Record<string, unknown> = {
      decision: "approve",
      risk: "elevated",
      confidence: "high",
      reason: "Requested dev server stays up.",
      userRequestedPersistence: true,
    };
    const review = async () => {
      const result = await reviewCommandSafety({
        toolCall: call("run_terminal_command", { command: "npm run dev", keepAlive: true }),
        actionContext: { requiresConfirmation: true, dangerLevel: "caution", warningMessage: "review", command: "npm run dev", keepAlive: true },
        providerConfig: { model: "deepseek-chat", apiKey: "[REDACTED]", baseUrl: "https://api.deepseek.com" } as AppConfig,
        originalUserRequest: "deja las herramientas activas entre turnos",
        complete: async (_signal, request) => {
          systemPrompt = String(request.messages[0]?.content ?? "");
          userPayload = JSON.parse(String(request.messages[1]?.content ?? "{}")) as Record<string, unknown>;
          return response(reply);
        },
      });
      return result;
    };

    const approved = await review();
    assert.match(systemPrompt, /userRequestedPersistence/);
    assert.strictEqual(userPayload.originalUserRequest, "deja las herramientas activas entre turnos");
    assert.strictEqual(approved.decision, "approve");
    assert.strictEqual(approved.userRequestedPersistence, true);

    reply = { decision: "approve", risk: "routine", confidence: "very_high", reason: "Plain dev server.", userRequestedPersistence: false };
    const declined = await review();
    assert.strictEqual(declined.decision, "manual_confirmation");
    assert.match(declined.reason, /does not clearly ask to keep this process running/);

    reply = { decision: "approve", risk: "routine", confidence: "very_high", reason: "Missing verdict." };
    const missing = await review();
    assert.strictEqual(missing.decision, "manual_confirmation");
    assert.match(missing.reason, /did not state whether the user asked/);
  });

  test("rejects an unexpected persistence verdict for ordinary commands", () => {
    assert.strictEqual(parseCommandSafetyReview(JSON.stringify({
      decision: "approve",
      risk: "routine",
      confidence: "high",
      reason: "ok",
      userRequestedPersistence: true,
    })).decision, "manual_confirmation");
    assert.deepStrictEqual(parseCommandSafetyReview(JSON.stringify({
      decision: "approve",
      risk: "routine",
      confidence: "high",
      reason: "ok",
      userRequestedPersistence: true,
    }), { requirePersistenceIntent: true }), {
      decision: "approve",
      risk: "routine",
      confidence: "high",
      reason: "ok",
      userRequestedPersistence: true,
    });
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


suite("command safety review boundary cases", () => {
  const valid = { decision: "approve", risk: "routine", confidence: "high", reason: "  Narrow requested operation.  " };
  const context = { requiresConfirmation: true as const, dangerLevel: "caution" as const, warningMessage: "Review" };
  for (const confidence of ["very_high", "high", "medium_high", "medium", "medium_low", "low", "very_low"] as const) {
    test(`preserves valid confidence ${confidence} and admits only the three automatic levels`, () => {
      const parsed = parseCommandSafetyReview(JSON.stringify({ ...valid, confidence }));
      assert.strictEqual(parsed.confidence, confidence); assert.strictEqual(parsed.reason, "Narrow requested operation.");
      assert.strictEqual(isAutomaticConfidence(confidence), ["very_high", "high", "medium_high"].includes(confidence));
    });
  }
  for (const [field, value] of [["decision", "execute"], ["risk", "safe"], ["confidence", "certain"], ["reason", 42], ["reason", "   "], ["reason", "x".repeat(1001)]] as const) {
    test(`fails closed for invalid ${field}=${String(value).slice(0, 25)}`, () => {
      const parsed = parseCommandSafetyReview(JSON.stringify({ ...valid, [field]: value }));
      assert.strictEqual(parsed.decision, "manual_confirmation"); assert.strictEqual(parsed.risk, "critical"); assert.strictEqual(parsed.confidence, "very_low"); assert.match(parsed.reason, /malformed/);
    });
  }
  test("accepts revise/manual decisions and elevated/critical risk without flattening their meaning", () => {
    for (const decision of ["approve", "revise", "manual_confirmation"]) {
      for (const risk of ["routine", "elevated", "critical"]) {
        const parsed = parseCommandSafetyReview(JSON.stringify({ ...valid, decision, risk })); assert.strictEqual(parsed.decision, decision); assert.strictEqual(parsed.risk, risk);
      }
    }
    assert.strictEqual(parseCommandSafetyReview(JSON.stringify({ ...valid, reason: "x".repeat(1000) })).reason.length, 1000);
  });
  for (const content of [undefined, null, "", "not JSON", "null", "[]", "42"]) {
    test(`does not approve an empty or malformed response ${String(content)}`, () => {
      const parsed = parseCommandSafetyReview(content); assert.strictEqual(parsed.decision, "manual_confirmation"); assert.strictEqual(parsed.confidence, "very_low");
    });
  }
  test("requires a boolean persistence verdict rather than truthy strings", () => {
    for (const userRequestedPersistence of ["true", 1, null]) {
      const parsed = parseCommandSafetyReview(JSON.stringify({ ...valid, userRequestedPersistence }), { requirePersistenceIntent: true });
      assert.strictEqual(parsed.decision, "manual_confirmation"); assert.match(parsed.reason, /did not state/);
    }
  });
  test("never transmits malformed or unextractable tool actions", async () => {
    const calls = [call("unknown", {}), call("edit_file", { path: " " }), call("edit_file", { path: 42 }), call("edit_file", { command: "  " }),
      { ...call("edit_file", {}), function: { name: "edit_file", arguments: "{" } }, { ...call("unknown", {}), function: { name: "unknown", arguments: "null" } }];
    for (const toolCall of calls) {
      let sent = false; const review = await reviewCommandSafety({ toolCall, actionContext: context, providerConfig: DEFAULT_CONFIG,
        complete: async () => { sent = true; return response(valid); } });
      assert.strictEqual(sent, false); assert.strictEqual(review.decision, "manual_confirmation"); assert.match(review.reason, /could not be extracted/);
    }
  });
  for (const command of ["echo access_token=example", "echo Bearer abcdefghijkl", "echo sk-abcdefghijk"]) {
    test(`does not send sensitive command text: ${command.split(" ")[1]}`, async () => {
      let sent = false; const review = await reviewCommandSafety({ toolCall: call("run_terminal_command", { command }), actionContext: context, providerConfig: DEFAULT_CONFIG,
        complete: async () => { sent = true; return response(valid); } });
      assert.strictEqual(sent, false); assert.strictEqual(review.risk, "elevated"); assert.match(review.reason, /not sent for remote review/);
    });
  }
  for (const [toolName, args, expected] of [
    ["move_path", { path: " src/a.ts ", destination: " src/b.ts ", content: "PRIVATE" }, 'move_path path="src/a.ts" destination="src/b.ts"'],
    ["delete_path", { path: "src/a.ts", recursive: true, permanent: true }, 'delete_path path="src/a.ts" recursive=true permanent=true'],
    ["delete_path", { path: "src/a.ts", recursive: false, destination: 12 }, 'delete_path path="src/a.ts" recursive=false permanent=false'],
  ] as const) {
    test(`reviews only the mechanical scope of ${toolName}: ${expected}`, async () => {
      let payload: Record<string, unknown> = {};
      const review = await reviewCommandSafety({ toolCall: call(toolName, args), actionContext: context, providerConfig: DEFAULT_CONFIG,
        complete: async (_signal, request) => { payload = JSON.parse(String(request.messages[1].content)); return response(valid); } });
      assert.strictEqual(review.decision, "approve"); assert.strictEqual(payload.proposedAction, expected); assert.doesNotMatch(JSON.stringify(payload), /PRIVATE/);
    });
  }
  test("preserves explicit action context over tool arguments and bounds user intent", async () => {
    let payload: Record<string, unknown> = {};
    await reviewCommandSafety({ toolCall: call("create_file", { path: "file.ts", command: "ignored" }), actionContext: { ...context, command: " selected action " }, providerConfig: DEFAULT_CONFIG, originalUserRequest: "x".repeat(5000),
      complete: async (_signal, request) => { payload = JSON.parse(String(request.messages[1].content)); return response(valid); } });
    assert.strictEqual(payload.proposedAction, "selected action"); assert.strictEqual((payload.originalUserRequest as string).length, 4000);
  });
  for (const [relative, inside] of [[".", true], ["src", true], ["..", false], ["../outside", false]] as const) {
    test(`reports mechanical cwd scope for ${relative}`, async () => {
      const root = path.resolve("review-workspace"); const cwd = path.resolve(root, relative); let payload: Record<string, unknown> = {};
      await reviewCommandSafety({ toolCall: call("create_file", { path: "file.ts" }), actionContext: { ...context, cwd, workspaceContained: false }, workspaceRoot: root, providerConfig: { ...DEFAULT_CONFIG, privacyMinimizeData: false },
        complete: async (_signal, request) => { payload = JSON.parse(String(request.messages[1].content)); return response(valid); } });
      assert.strictEqual(payload.cwd, cwd); assert.strictEqual(payload.workspaceRoot, root); assert.strictEqual((payload.scopeFacts as Record<string, unknown>).cwdInsideWorkspace, inside); assert.strictEqual((payload.scopeFacts as Record<string, unknown>).pathInsideWorkspace, false);
    });
  }
  test("uses explicit unknowns for unavailable scope and reports usage from the selected model", async () => {
    let payload: Record<string, unknown> = {}; const observed: unknown[] = []; const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
    await reviewCommandSafety({ toolCall: call("create_file", { path: "file.ts" }), actionContext: context, providerConfig: { ...DEFAULT_CONFIG, privacyMinimizeData: false },
      complete: async (_signal, request) => { payload = JSON.parse(String(request.messages[1].content)); return { ...response(valid), usage }; }, onUsage: (value, model) => { observed.push({ value, model }); } });
    assert.strictEqual(payload.cwd, "Unknown"); assert.strictEqual(payload.workspaceRoot, "Unknown"); assert.strictEqual(payload.shell, "Unknown"); assert.strictEqual(payload.originalUserRequest, "No original user request was available.");
    assert.deepStrictEqual(observed, [{ value: usage, model: DEFAULT_CONFIG.model }]);
  });
  test("the default HTTP client sends the review request and parses its decision", async () => {
    const originalFetch = globalThis.fetch; let requests = 0;
    globalThis.fetch = async (_url, init) => { requests++; const request = JSON.parse(String(init?.body)); assert.deepStrictEqual(request.thinking, { type: "disabled" }); return Response.json(response(valid)); };
    try {
      const result = await reviewCommandSafety({ toolCall: call("create_file", { path: "file.ts" }), actionContext: context, providerConfig: { ...DEFAULT_CONFIG, apiKey: "test-key" } });
      assert.strictEqual(requests, 1); assert.strictEqual(result.decision, "approve"); assert.strictEqual(result.reason, "Narrow requested operation.");
    } finally { globalThis.fetch = originalFetch; }
  });
  test("external cancellation propagates instead of becoming a manual-review answer", async () => {
    const controller = new AbortController(); const error = new Error("cancelled review");
    await assert.rejects(reviewCommandSafety({ toolCall: call("create_file", { path: "file.ts" }), actionContext: context, providerConfig: DEFAULT_CONFIG, signal: controller.signal,
      complete: async () => { controller.abort(); throw error; } }), (actual) => actual === error);
  });
});

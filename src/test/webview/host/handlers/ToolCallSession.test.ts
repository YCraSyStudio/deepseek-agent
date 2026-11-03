import assert from "node:assert/strict";
import { ToolCallSession } from "@/vscode/webviews/handlers/chat/toolCalls/ToolCallSession";
import type { ToolCallRunOptions } from "@/vscode/webviews/handlers/chat/toolCalls/Types";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import { DEFAULT_CONFIG, type PermissionSnapshot, type ToolCall } from "@/contracts";
import { runWithToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { createWorkspaceHost } from "../../../chat/toolCall/execution/executionHarness";

suite("tool session public execution lifecycle", () => {
  let originalFetch: typeof fetch; let registry: ToolRegistry; let session: ToolCallSession;
  let events: Array<Record<string, unknown>>; let rounds: ToolCall[][]; let requests: Array<Record<string, unknown>>; let executed: string[];
  let onEvent: ((event: Record<string, unknown>) => void) | undefined;
  const permission = (permissionMode: PermissionSnapshot["permissionMode"]): PermissionSnapshot => ({ permissionMode, revision: 1, workspaceTrusted: true, fingerprint: "fixture" });
  const call = (id = "call", name = "lookup", args = "{}"): ToolCall => ({ id, type: "function", function: { name, arguments: args } });
  setup(() => {
    originalFetch = globalThis.fetch; registry = new ToolRegistry(); session = new ToolCallSession(new ToolExecutor(registry)); events = []; rounds = [[call()], []]; requests = []; executed = []; onEvent = undefined;
    register("lookup");
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>; requests.push(request);
      if (request.tool_choice === "none") { return Response.json({ id: "review", object: "chat.completion", created: 1, model: "deepseek-flash", choices: [{ index: 0, message: { role: "assistant", content: '{"decision":"complete","reason":"done"}' }, finish_reason: "stop" }] }); }
      const calls = rounds.shift(); assert.ok(calls, "Unexpected provider request");
      const delta = calls.length ? { tool_calls: calls.map((item, index) => ({ ...item, index })) } : { content: "Finished", reasoning_content: "Checked" };
      const data = [{ choices: [{ index: 0, delta, finish_reason: calls.length ? "tool_calls" : "stop" }] }, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }];
      return new Response(`${data.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
  });
  teardown(() => { globalThis.fetch = originalFetch; session.cancel(); });
  function register(name: string, handler?: () => Promise<string>, forcedHandler?: () => Promise<string>) {
    registry.register({ definition: { type: "function", function: { name, description: "Test lookup", parameters: { type: "object", properties: {} } } }, metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "read-only" },
      handler: handler ?? (async () => { executed.push(name); return "lookup result"; }), forcedHandler });
  }
  function options(patch: Partial<ToolCallRunOptions> = {}): ToolCallRunOptions {
    const snapshot = permission("full-access");
    return { messages: [{ role: "user", content: "look up the result" }], tools: registry.getDefinitionsForAPI(), providerConfig: { ...DEFAULT_CONFIG, apiKey: "test-key", model: "deepseek-flash" },
      eventSink: { publish: (event) => { events.push(event); onEvent?.(event); } }, permissionSnapshot: snapshot, capturePermissionSnapshot: async () => snapshot,
      exposeReasoning: true, isCancelling: () => false, isWorkspaceTrusted: () => true, generationId: "generation", conversationId: "chat", trustedUserRequest: "look up the result", authorizedUserUrls: [],
      budgetManager: new GenerationBudgetManager("deepseek-flash", 4096), ...patch };
  }
  function event(type: string) { const found = events.find((item) => item.type === type); assert.ok(found, `Missing ${type}`); return found; }
  test("marks subsequent tool contexts after web content and clears that state for the next run", async () => {
    const observed: Array<boolean | undefined> = [];
    for (const name of ["read_web", "inspect_context"]) {
      register(name); registry.register({ ...registry.get(name)!, handler: async (_args, context) => { observed.push(context?.webTainted); return "Result"; } });
    }
    rounds = [[call("web", "read_web")], [call("inspect", "inspect_context")], []];
    assert.equal((await session.run(options()))?.content, "Finished"); assert.deepEqual(observed, [false, true]);
    rounds = [[call("inspect-next", "inspect_context")], []];
    await session.run(options()); assert.deepEqual(observed, [false, true, false]);
  });
  test("executes a confirmed operation after remote safety approval and records review usage", async () => {
    register("external_action", async () => JSON.stringify({ requiresConfirmation: true, dangerLevel: "caution", warningMessage: "Review operation", command: "custom-operation" }), async () => { executed.push("approved"); return "Approved result"; });
    registry.register({ ...registry.get("external_action")!, metadata: { dangerLevel: "caution", requiresConfirmation: true, scope: "workspace", effect: "external-effect" } });
    onEvent = event => { if (event.type === "toolCallConfirmationRequired") { session.handleUserAction({ toolCallId: "reviewed", action: "reject" }); } };
    rounds = [[call("reviewed", "external_action")], []]; const normalFetch = globalThis.fetch; let reviews = 0;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.stream && body.tool_choice !== "none") {
        reviews++;
        return Response.json({ id: "security", object: "chat.completion", created: 1, model: "deepseek-flash",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ decision: "approve", risk: "routine", confidence: "very_high", reason: "Operation is bounded" }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } });
      }
      return normalFetch(url, init);
    };
    const phases: string[] = []; const result = await runWithToolWorkspaceHost(createWorkspaceHost(), () => session.run(options({ onUsage: phase => { phases.push(phase); } })));
    assert.equal(reviews, 1, JSON.stringify(events)); assert.deepEqual(executed, ["approved"], JSON.stringify(events.filter(event => event.type === "toolCallConfirmationRequired"))); assert.ok(phases.includes("security_review"));
    assert.equal(result?.toolCalls?.[0].status, "completed"); assert.equal(result?.toolCalls?.[0].result, "Approved result");
  });
  test("reports progress-review usage after twenty model tool rounds", async () => {
    rounds = [...Array.from({ length: 20 }, (_, index) => [call(`round-${index}`)]), []];
    const phases: string[] = [];
    const result = await session.run(options({ onUsage: phase => { phases.push(phase); } }));
    assert.equal(result?.content, "Finished"); assert.ok(phases.includes("progress_review"));
    assert.equal(requests.filter(request => request.tool_choice !== "none").length, 21);
  });
  test("publishes a single concise-recovery event after excessive streamed reasoning", async () => {
    const normalFetch = globalThis.fetch; let initial = true;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (initial && body.tool_choice !== "none") {
        initial = false; requests.push(body);
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "r".repeat(310) }, finish_reason: null }] })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
      return normalFetch(url, init);
    };
    const result = await session.run(options({ providerConfig: { ...DEFAULT_CONFIG, apiKey: "test-key", model: "deepseek-flash", maxTokens: 128 },
      budgetManager: new GenerationBudgetManager("deepseek-flash", 128) }));
    assert.equal(result?.content, "Finished");
    assert.equal(events.filter(item => item.type === "generationRecoveryStarted").length, 1);
    assert.equal((requests[1].thinking as { type: string }).type, "disabled");
    assert.ok(executed.includes("lookup"));
  });

  test("executes an automatic read, streams its answer and returns the tool transcript", async () => {
    const snapshots: PermissionSnapshot[] = []; const phases: string[] = []; const transcripts: string[] = [];
    const result = await session.run(options({ onPermissionSnapshot: (value) => { snapshots.push(value); }, onUsage: (phase) => { phases.push(phase); }, onTranscriptUpdate: (value) => { transcripts.push(value.status); } }));
    assert.deepEqual(executed, ["lookup"]); assert.equal(result?.content, "Finished"); assert.equal(result?.toolCalls?.[0].status, "completed"); assert.equal(result?.toolCalls?.[0].result, "lookup result");
    assert.ok(result?.providerTranscript); assert.equal(transcripts.at(-1), "complete"); assert.ok(snapshots.length >= 2); assert.ok(phases.includes("tool_round")); assert.ok(phases.includes("completion_review")); assert.equal(event("toolCallStarted").round, 1);
    assert.equal(events.some((item) => item.type === "toolCallConfirmationRequired"), false);
  });
  for (const action of ["execute", "reject"] as const) {
    test(`manual ${action} resolves only the selected pending call and ignores duplicate/missing actions`, async () => {
      session.handleUserAction({ toolCallId: "not-pending", action });
      onEvent = (item) => { if (item.type === "toolCallConfirmationRequired") { session.handleUserAction({ toolCallId: "missing", action }); session.handleUserAction({ toolCallId: "call", action }); session.handleUserAction({ toolCallId: "call", action }); } };
      const snapshot = permission("default"); const result = await session.run(options({ permissionSnapshot: snapshot, capturePermissionSnapshot: async () => snapshot }));
      assert.equal(result?.toolCalls?.[0].status, action === "execute" ? "completed" : "rejected"); assert.equal(executed.length, action === "execute" ? 1 : 0);
      assert.equal(events.filter((item) => item.type === "toolCallActionAccepted").length, 1);
    });
  }
  test("cancelling pending manual calls releases the cycle without executing them", async () => {
    const abort = new AbortController(); const snapshot = permission("default");
    onEvent = (item) => { if (item.type === "toolCallConfirmationRequired") { abort.abort(); session.cancel(); } };
    await session.run(options({ permissionSnapshot: snapshot, capturePermissionSnapshot: async () => snapshot, signal: abort.signal, isCancelling: () => true }));
    assert.deepEqual(executed, []); assert.ok(events.some((item) => item.type === "toolCallResult" && item.status === "cancelled")); session.cancel();
  });
  for (const action of ["execute", "reject"] as const) {
    test(`danger confirmation ${action} controls forced execution`, async () => {
      register("lookup", async () => JSON.stringify({ requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "Needs approval" }), async () => { executed.push("forced"); return "forced result"; });
      // Auto mode explicitly admits this tool through its confirmation-aware path.
      registry.get("lookup")!.metadata.alwaysConfirmWhen = { argument: "action", values: ["remove"] }; rounds = [[call("call", "lookup", '{"action":"remove"}')], []];
      onEvent = (item) => { if (item.type === "toolCallConfirmationRequired" && item.dangerConfirmation) { session.handleUserAction({ toolCallId: "call", action }); } };
      const result = await session.run(options()); assert.equal(result?.toolCalls?.[0].status, action === "execute" ? "completed" : "rejected"); assert.deepEqual(executed, action === "execute" ? ["forced"] : []);
    });
  }
  test("cancels a pending danger confirmation without forced execution", async () => {
    register("lookup", async () => JSON.stringify({ requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "Needs approval" }), async () => { executed.push("forced"); return "forced"; });
    registry.get("lookup")!.metadata.alwaysConfirmWhen = { argument: "action", values: ["remove"] }; rounds = [[call("call", "lookup", '{"action":"remove"}')], []];
    onEvent = (item) => { if (item.type === "toolCallConfirmationRequired" && item.dangerConfirmation) { session.cancel(); } };
    await session.run(options()); assert.deepEqual(executed, []); assert.ok(events.some((item) => item.type === "toolCallResult" && item.status === "cancelled"));
  });
  test("automatic capture publishes a synthetic result and protocol-valid observation", async () => {
    let captured = false;
    const result = await session.run(options({ prepareAutomaticCapture: () => captured ? undefined : async () => { captured = true; return { content: "visible UI", request: { target: "screen" as const } }; } }));
    const capture = result?.toolCalls?.find((item) => item.toolName === "capture_screenshot"); assert.equal(capture?.status, "completed"); assert.equal(capture?.result, "visible UI"); assert.equal(JSON.parse(capture!.arguments).automatic, true);
    const next = requests.filter((item) => item.tool_choice !== "none")[1]; assert.match(JSON.stringify(next.messages), /visible UI/);
  });
  for (const error of [new Error("capture failed"), "capture rejected"]) {
    test(`automatic capture failure is an observation and preserves tool progress: ${String(error)}`, async () => {
      let attempted = false;
      const result = await session.run(options({ prepareAutomaticCapture: () => attempted ? undefined : async () => { attempted = true; throw error; } }));
      const capture = result?.toolCalls?.find((item) => item.toolName === "capture_screenshot"); assert.equal(capture?.status, "error"); assert.match(capture!.result!, /Automatic capture unavailable/); assert.equal(result?.content, "Finished");
    });
  }
  test("captures the UI before stopping an application preview", async () => {
    register("application_session", async () => { executed.push("stopped"); return "stopped"; }); rounds = [[call("stop", "application_session", '{"action":"stop"}')], []];
    let captured = false;
    const result = await session.run(options({ prepareAutomaticCapture: () => captured ? undefined : async () => { captured = true; executed.push("captured"); return { content: "last preview" }; } }));
    assert.deepEqual(executed, ["captured", "stopped"]); assert.equal(result?.toolCalls?.find((item) => item.toolName === "capture_screenshot")?.status, "completed");
  });
  test("records failed mutation attempts and blocks an unread retry in the same batch", async () => {
    register("edit_file", async () => { executed.push("edit"); return "Error: write failed"; });
    rounds = [[call("first", "edit_file", '{"path":"./file.ts","content":"first"}'), call("second", "edit_file", '{"path":"./file.ts","content":"second"}')], []];
    const result = await session.run(options()); assert.deepEqual(executed, ["edit"]); assert.equal(result?.toolCalls?.[0].status, "error"); assert.match(result!.toolCalls![1].result!, /Read the file successfully/);
  });
  test("explicit compaction carries successful outcomes into a smaller continuation", async () => {
    register("compact_context"); rounds = [[call("compact", "compact_context")], []]; const compacted: Array<{ estimatedTokensBefore: number; estimatedTokensAfter: number }> = []; let native = 0;
    const result = await session.run(options({ messages: [{ role: "user", content: "older context ".repeat(5000) }], prepareNativeImages: (messages) => { native++; return messages; }, onContextCompacted: (value) => { compacted.push(value); } }));
    assert.equal(result?.content, "Finished"); assert.equal(compacted.length, 1); assert.ok(compacted[0].estimatedTokensAfter < compacted[0].estimatedTokensBefore); assert.ok(native >= 2); assert.ok(event("contextCompacted"));
    assert.match(JSON.stringify(requests.filter((request) => request.tool_choice !== "none")[1].messages), /tool_cycle_continuation/);
  });
  test("exhausted compaction budgets emit a resource-limit error rather than looping", async () => {
    register("compact_context"); rounds = [[call("compact", "compact_context")], []]; const budgetManager = new GenerationBudgetManager("deepseek-flash", 4096);
    for (let count = 0; count < 3; count++) { budgetManager.recordAutomaticCompaction(); }
    const result = await session.run(options({ budgetManager })); assert.equal(event("resourceLimitReached").resource, "automatic_compactions"); assert.match(result!.error!, /compaction limit/); assert.equal(requests.length, 1);
  });

  test("filters beta-only tools when beta features become disabled", async () => {
    register("complete_code"); rounds = [[]]; await session.run(options({ isBetaFeaturesEnabled: () => false }));
    const tools = requests[0].tools as Array<{ function: { name: string } }>; assert.ok(tools.every((tool) => tool.function.name !== "complete_code"));
  });
  test("permission snapshots are refreshed before execution and can require manual approval", async () => {
    const snapshot = permission("default");
    onEvent = (item) => { if (item.type === "toolCallConfirmationRequired") { session.handleUserAction({ toolCallId: "call", action: "reject" }); } };
    const result = await session.run(options({ capturePermissionSnapshot: async () => snapshot }));
    assert.equal(result?.toolCalls?.[0].status, "rejected"); assert.deepEqual(executed, []);
  });
  test("hidden reasoning stays out of the visible event stream", async () => {
    rounds = [[]]; const result = await session.run(options({ exposeReasoning: false }));
    assert.equal(result?.content, "Finished"); assert.equal(events.some((item) => item.type === "streamTimelineDelta" && item.eventType === "reasoning"), false);
  });

  test("an already cancelled run does not contact the provider and leaves the session reusable", async () => {
    const abort = new AbortController(); abort.abort(); assert.equal(await session.run(options({ signal: abort.signal })), undefined); assert.equal(requests.length, 0);
    const result = await session.run(options()); assert.equal(result?.content, "Finished");
  });
});

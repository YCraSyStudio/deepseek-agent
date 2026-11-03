import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { cancelGeneration, postAvailableTools, steerGeneration, syncSelectedConversation } from "@/vscode/webviews/handlers/chat/session/ConversationControl";
import { handleToolCallRunError, postFinalToolCallMessage } from "@/vscode/webviews/handlers/chat/toolCalls/ToolCallOutcome";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { ToolCallRunOptions, StoredExecution } from "@/vscode/webviews/handlers/chat/toolCalls/Types";
import type { ToolRegistry } from "@/application/tools/ToolRegistry";
import type { ToolCallCycleResult } from "@/application/chat/toolCall";
import type { StreamEventEmitter } from "@/vscode/webviews/handlers/chat/streaming/StreamEventEmitter";

suite("conversation controls and tool outcomes", () => {
  function active(conversationId = "chat", stopReason?: "steered" | "user_cancelled") {
    return {
      generationId: "generation", task: { conversationId }, stopReason,
      completion: Promise.resolve(), controller: new AbortController(),
    };
  }

  function run(status: GenerationRunRecord["status"] = "streaming") {
    const cancelled: number[] = [];
    const record = {
      generationId: "generation", conversationId: "chat", clientRequestId: "request",
      session: { cancel: () => { cancelled.push(1); } }, content: "", timeline: [], toolCalls: [], status,
      eventLog: [], budgetManager: {},
    } as unknown as GenerationRunRecord;
    return { record, cancelled };
  }

  test("cancels only the matching live generation and preserves a recorded reason", () => {
    const { record, cancelled } = run();
    const interrupts: Array<[string, string]> = [];
    let current: ReturnType<typeof active> | undefined = active();
    const coordinator = {
      getActive: () => current,
      interrupt: (id: string, reason: string) => { interrupts.push([id, reason]); },
    } as unknown as GenerationCoordinator<SendMessagePayload>;
    assert.equal(cancelGeneration("generation", "other", coordinator, new Map()), false);
    current = undefined;
    assert.equal(cancelGeneration("generation", "chat", coordinator, new Map()), false);
    current = active();
    const terminal = run("cancelled").record;
    assert.equal(cancelGeneration("generation", "chat", coordinator, new Map([["generation", terminal]])), false);
    assert.equal(cancelGeneration("generation", "chat", coordinator, new Map([["generation", record]])), true);
    assert.equal(record.status, "cancelling");
    assert.equal(cancelled.length, 1);
    assert.deepEqual(interrupts, [["generation", "user_cancelled"]]);
    current = active("chat", "steered");
    const steered = run().record;
    assert.equal(cancelGeneration("generation", "chat", coordinator, new Map([["generation", steered]])), true);
    assert.equal(steered.status, "streaming");
  });

  test("steers only the matching live generation and enqueues front-loaded guidance", async () => {
    const { record } = run();
    const enqueued: SendMessagePayload[] = [];
    const interrupts: string[] = [];
    let current: ReturnType<typeof active> | undefined = active();
    const coordinator = {
      getActive: () => current,
      interrupt: (_id: string, reason: string) => { interrupts.push(reason); },
    } as unknown as GenerationCoordinator<SendMessagePayload>;
    const message = {
      type: "steerGeneration" as const, generationId: "generation", conversationId: "chat", clientRequestId: "steer",
      text: "Guidance", modelId: "deepseek-flash", reasoning: "off", workspaceRevision: "rev",
      referencedFiles: [], imageAttachments: [],
    };
    const runs = new Map([["generation", record]]);
    steerGeneration(message, coordinator, runs, async (payload) => { enqueued.push(payload); });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(enqueued.length, 1);
    assert.deepEqual(enqueued[0].steering, { sourceGenerationId: "generation" });
    assert.deepEqual(interrupts, ["steered"]);
    current = active("other");
    steerGeneration(message, coordinator, runs, async (payload) => { enqueued.push(payload); });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(enqueued.length, 1);
  });

  test("posts available tool metadata and mirrors only the selected conversation", () => {
    const posts: unknown[] = [];
    const view = { webview: { postMessage: async (message: unknown) => { posts.push(message); } } } as unknown as vscode.WebviewView;
    const registry = {
      getDefinitionsForAPI: () => [{ type: "function", function: { name: "one", description: "First", parameters: { type: "object", properties: { path: { type: "string" } } } } }],
    } as unknown as ToolRegistry;
    postAvailableTools(view, registry);
    assert.deepEqual(posts, [{ type: "availableTools", tools: [{ name: "one", description: "First", parameters: [{ name: "path", type: "string", required: false, description: "" }] }] }]);
    const loaded: string[] = [];
    const source = { getActiveConversationId: () => "active", getConversation: () => ({ id: "active" }) } as unknown as ConversationState;
    const target = { load: (conversation: { id: string }) => { loaded.push(conversation.id); } } as unknown as ConversationState;
    syncSelectedConversation(source, "other", target);
    assert.deepEqual(loaded, []);
    syncSelectedConversation(source, "active", target);
    assert.deepEqual(loaded, ["active"]);
    syncSelectedConversation({ getActiveConversationId: () => "active", getConversation: () => undefined } as unknown as ConversationState, "active", target);
    assert.deepEqual(loaded, ["active"]);
  });

  function options(overrides: Partial<ToolCallRunOptions> = {}): ToolCallRunOptions {
    return {
      messages: [], tools: [], providerConfig: {} as ToolCallRunOptions["providerConfig"],
      eventSink: { publish: () => undefined }, permissionSnapshot: {} as ToolCallRunOptions["permissionSnapshot"],
      capturePermissionSnapshot: async () => ({}) as never, exposeReasoning: true, isCancelling: () => false,
      isWorkspaceTrusted: () => true, generationId: "generation", trustedUserRequest: "", authorizedUserUrls: [],
      budgetManager: {} as ToolCallRunOptions["budgetManager"], ...overrides,
    };
  }

  function stream(timeline: Array<{ id: string; type: "content"; content: string }> = []) {
    const calls: Array<[string, unknown]> = [];
    return {
      calls,
      stream: {
        getTimeline: () => timeline,
        done: (options: unknown) => { calls.push(["done", options]); },
        error: (error: string) => { calls.push(["error", error]); },
      } as unknown as StreamEventEmitter,
    };
  }

  function result(content: string, finish_reason: "stop" | "length" = "stop"): ToolCallCycleResult {
    return {
      finalMessage: { role: "assistant", content },
      response: { choices: [{ finish_reason }] },
      transcript: [{ role: "assistant", content }],
    } as unknown as ToolCallCycleResult;
  }

  test("posts a final assistant message and reports completeness", () => {
    const events: Array<Record<string, unknown>> = [];
    const first = stream();
    const complete = postFinalToolCallMessage({ options: options({ eventSink: { publish: (event) => { events.push(event); } } }), stream: first.stream, result: result("Final"), executedToolCalls: new Map(), streamedContent: "" });
    assert.equal(complete.content, "Final");
    assert.equal(complete.partial, false);
    assert.equal(complete.providerTranscript?.status, "complete");
    assert.equal(events[0].type, "addMessage");
    assert.deepEqual(first.calls, [["done", { finish_reason: "stop" }]]);

    const second = stream([{ id: "text", type: "content", content: "streamed" }]);
    const streamed = postFinalToolCallMessage({ options: options(), stream: second.stream, result: result("Final", "length"), executedToolCalls: new Map(), streamedContent: "streamed" });
    assert.equal(streamed.content, "streamed");
    assert.equal(streamed.partial, true);
    assert.equal(streamed.providerTranscript?.status, "incomplete");

    const tools = new Map<string, StoredExecution>([["call", { toolCallId: "call", toolName: "one", arguments: "{}", status: "completed" }]]);
    const third = stream();
    const withTools = postFinalToolCallMessage({ options: options(), stream: third.stream, result: result(""), executedToolCalls: tools, streamedContent: "" });
    assert.equal(withTools.toolCalls?.length, 1);
    assert.equal(third.calls[0][0], "done");
  });

  test("marks unfinished executions as cancelled and only posts a partial assistant when allowed", () => {
    const executions = new Map<string, StoredExecution>([["pending", { toolCallId: "pending", toolName: "one", arguments: "{}", status: "pending" }]]);
    const events: Array<Record<string, unknown>> = [];
    const first = stream([{ id: "text", type: "content", content: "partial" }]);
    const optionsValue = options({ signal: AbortSignal.abort(), isCancelling: () => true, eventSink: { publish: (event) => { events.push(event); } } });
    const cancelled = handleToolCallRunError({ err: new Error("cancelled"), options: optionsValue, stream: first.stream, executedToolCalls: executions, streamedContent: "partial" });
    assert.equal(executions.get("pending")?.status, "cancelled");
    assert.equal(cancelled?.partial, true);
    assert.deepEqual(first.calls, []);
    assert.equal(events.some((event) => event.type === "toolCallResult" && event.status === "cancelled"), true);

    const second = stream();
    const allowed = handleToolCallRunError({ err: new Error("cancelled"), options: options({ signal: AbortSignal.abort(), isCancelling: () => false }), stream: second.stream, executedToolCalls: new Map(), streamedContent: "" });
    assert.equal(allowed, undefined);
    assert.deepEqual(second.calls, [["done", { status: "interrupted" }]]);
  });

  test("reports non-cancellation failures with completed and failed tool state", () => {
    const executions = new Map<string, StoredExecution>([
      ["running", { toolCallId: "running", toolName: "one", arguments: "{}", status: "running", result: "kept" }],
      ["completed", { toolCallId: "completed", toolName: "one", arguments: "{}", status: "completed" }],
    ]);
    const events: Array<Record<string, unknown>> = [];
    const emitter = stream();
    const failed = handleToolCallRunError({
      err: new Error("token abc"), options: options({ eventSink: { publish: (event) => { events.push(event); } } }),
      stream: emitter.stream, executedToolCalls: executions, streamedContent: "partial",
    });
    assert.equal(executions.get("running")?.status, "error");
    assert.equal(executions.get("running")?.isError, true);
    assert.equal(executions.get("running")?.result, "kept");
    assert.equal(executions.get("completed")?.status, "completed");
    assert.equal(failed?.error?.startsWith("Error en tool calls:"), true);
    assert.equal(emitter.calls[0][0], "error");
    assert.equal(events.filter((event) => event.type === "addMessage").length, 1);
  });
  test("publishes interrupted tool results when cancellation was not initiated by the host", () => {
    const events: Array<Record<string, unknown>> = [];
    const executions = new Map<string, StoredExecution>([
      ["waiting", { toolCallId: "waiting", toolName: "one", arguments: "{}", status: "awaiting_confirmation", requiresConfirmation: true }],
    ]);
    const emitter = stream();
    const partial = handleToolCallRunError({ err: new Error("cancelled"),
      options: options({ signal: AbortSignal.abort(), eventSink: { publish: event => { events.push(event); } } }),
      stream: emitter.stream, executedToolCalls: executions, streamedContent: "" });
    assert.equal(partial?.partial, true);
    assert.equal(partial?.toolCalls?.[0].status, "cancelled");
    assert.equal(partial?.toolCalls?.[0].requiresConfirmation, false);
    assert.equal(partial?.toolCalls?.[0].isError, false);
    assert.equal(partial?.toolCalls?.[0].result, "Cancelled with the active generation.");
    const message = events.find(event => event.type === "addMessage")?.message as Record<string, unknown>;
    assert.equal(message.content, ""); assert.equal(message.wasStreamed, false);
    assert.deepEqual(emitter.calls, [["done", { status: "interrupted" }]]);
  });

  test("does not invent an assistant message or successful finish for an empty provider response", () => {
    const events: Array<Record<string, unknown>> = [];
    const response = result(""); response.response.choices = [];
    const emitter = stream();
    const output = postFinalToolCallMessage({ options: options({ eventSink: { publish: event => { events.push(event); } } }),
      stream: emitter.stream, result: response, executedToolCalls: new Map(), streamedContent: "" });
    assert.deepEqual(events, []); assert.equal(output.partial, true);
    assert.equal(output.content, ""); assert.equal(output.toolCalls, undefined);
    assert.deepEqual(emitter.calls, [["done", { finish_reason: undefined }]]);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { GenerationExecutor } from "@/vscode/webviews/handlers/chat/generation/GenerationExecutor";
import { transitionGenerationRun, type GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { GenerationTask, GenerationStopReason } from "@/application/chat/GenerationCoordinator";
import { ConversationState } from "@/application/chat/ConversationState";
import type { ToolHandlerContext } from "@/application/tools/Types";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import type { SettingsRepository, ModelProvider } from "@/application/ports";
import { DEFAULT_CONFIG, type AppConfig, type ChatCompletionRequest } from "@/contracts";
import { resetVsCodeMock } from "../../../support/VsCodeMock";
import { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";

suite("generation executor public lifecycle", () => {
  let originalFetch: typeof fetch; let root: string; let previousMode: string | undefined; let previousData: string | undefined;
  let config: AppConfig; let apiKey: string | undefined; let events: Array<Record<string, unknown>>; let requests: ChatCompletionRequest[];
  let runs: Map<string, GenerationRunRecord>; let state: ConversationState; let latestState: ConversationState; let history: HistoryManager; let executor: GenerationExecutor; let registry: ToolRegistry;
  let archived: string[]; let checkpoints: string[]; let deleted: string[]; let mode: "success" | "error" | "partial-error" | "partial-cancel" | "cancel";
  let controller: AbortController; let stopReason: GenerationStopReason; let permissionError: Error | undefined;
  setup(async () => {
    resetVsCodeMock(); originalFetch = globalThis.fetch; root = await mkdtemp(path.join(tmpdir(), "generation-executor-")); previousMode = process.env.NODE_ENV; previousData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
    config = { ...DEFAULT_CONFIG, historyEnabled: false }; apiKey = "test-key"; events = []; requests = []; archived = []; checkpoints = []; deleted = []; mode = "success"; controller = new AbortController(); stopReason = "user_cancelled"; permissionError = undefined;
    const settings = { load: () => config, waitForPendingWrites: async () => undefined, capturePermissionSnapshot: async () => {
      if (permissionError) { throw permissionError; } return { revision: 1, permissionMode: "full-access", workspaceTrusted: true, fingerprint: "fixture" };
    } } as unknown as SettingsRepository;
    history = new HistoryManager(settings); state = new ConversationState(history, "incognito"); latestState = state; runs = new Map(); registry = new ToolRegistry();
    const provider: ModelProvider = { id: "fixture", name: "Fixture", testConnection: async () => ({ success: true }), listModels: async () => [],
      chatCompletion: async () => { throw new Error("Unexpected nonstream request"); },
      chatCompletionStream: async (request, onChunk) => {
        requests.push(request);
        if (mode === "error") { throw new Error("provider unavailable"); }
        if (mode === "cancel") { cancel(); throw new DOMException("Cancelled", "AbortError"); }
        onChunk({ type: "reasoning", reasoning_content: "Thinking" }); onChunk({ type: "content", content: "Answer" });
        if (mode === "partial-error") { throw new Error("connection lost"); }
        if (mode === "partial-cancel") { cancel(); throw new DOMException("Cancelled", "AbortError"); }
        onChunk({ type: "usage", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }); onChunk({ type: "done", finish_reason: "stop" });
      },
    };
    const dependencies: ConstructorParameters<typeof GenerationExecutor>[0] = {
      historyManager: history, activeConversationState: state, toolRegistry: registry, runs,
      checkpointStore: { delete: async (id: string) => { deleted.push(id); } } as ConstructorParameters<typeof GenerationExecutor>[0]["checkpointStore"],
      generationEventCallbacks: { scheduleCheckpoint: (record) => { checkpoints.push(record.generationId); }, checkpointImmediately: (record) => { checkpoints.push(record.generationId); }, postIfSelected: (_record, event) => { events.push(event); } },
      checkpoint: async (record) => { checkpoints.push(record.generationId); }, scheduleCheckpoint: (record) => { checkpoints.push(record.generationId); },
      syncSelectedConversation: (current) => { latestState = current; const value = current.getConversation(); if (value) { state.load(value); } }, post: (event) => { events.push(event); }, settings,
      secrets: { getApiKey: async () => apiKey, migrateLegacyApiKey: async () => undefined, setApiKey: async () => undefined, deleteApiKey: async () => undefined }, modelProviderFactory: { create: () => provider },
      archiveImages: async (id) => { archived.push(id); },
    };
    executor = new GenerationExecutor(dependencies);
  });
  teardown(async () => {
    globalThis.fetch = originalFetch; resetVsCodeMock(); for (const [name, value] of [["NODE_ENV", previousMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", previousData]]) { if (value === undefined) { delete process.env[name!]; } else { process.env[name!] = value; } }
    await rm(root, { recursive: true, force: true });
  });
  function cancel() {
    // ConversationControl marks user cancellation before signalling the executor.
    const record = runs.get("generation");
    if (record && stopReason === "user_cancelled") { transitionGenerationRun(record, "cancelling"); record.session.cancel(); }
    controller.abort({ kind: "generation_abort", reason: stopReason });
  }
  function task(patch: Partial<SendMessagePayload> = {}): GenerationTask<SendMessagePayload> {
    return { conversationId: "chat", clientRequestId: "request", queuedAt: 1, payload: { clientRequestId: "request", text: "Question", modelId: "deepseek-flash", reasoning: "off", ...patch } };
  }
  async function execute(patch: Partial<SendMessagePayload> = {}) { await executor.executeInWorkspace("generation", task(patch), controller.signal); }
  function terminal() { return events.filter((event) => event.type === "streamDone" || event.type === "streamError"); }
  test("streams an incognito response, reconciles the conversation and finalizes exactly once", async () => {
    await execute(); const messages = latestState.getConversation()!.messages;
    assert.deepEqual(messages.map((message) => [message.role, message.content]), [["user", "Question"], ["assistant", "Answer"]]); assert.equal(messages[1].generationStatus, "completed");
    assert.equal(requests[0].thinking?.type, "disabled"); assert.equal(terminal().length, 1); assert.equal(terminal()[0].type, "streamDone"); assert.equal(terminal()[0].status, "completed"); assert.equal(runs.size, 0); assert.ok(deleted.includes("chat")); assert.deepEqual(archived, []);
    assert.ok(events.some((event) => event.type === "assistantUsageUpdated"));
  });
  test("uses configured model defaults and maps requested reasoning", async () => {
    await execute({ modelId: "", reasoning: "high" }); assert.equal(requests[0].model, config.model); assert.equal(requests[0].thinking?.type, "enabled"); assert.equal(requests[0].reasoning_effort, "high");
    assert.equal(latestState.getApiMessages().filter(message => message.role === "assistant")[0].reasoning_content, "Thinking");
  });
  for (const reason of ["user_cancelled", "workspace_changed"] as const) {
    test(`an already aborted ${reason} generation emits its terminal status without creating a run`, async () => {
      stopReason = reason; cancel(); await execute(); assert.equal(requests.length, 0); assert.equal(runs.size, 0); assert.deepEqual(terminal(), [{ type: "streamDone", generationId: "generation", conversationId: "chat", status: reason === "user_cancelled" ? "cancelled" : "interrupted", generationStopReason: reason }]);
    });
  }
  test("permission capture failures before run creation become a scoped stream error", async () => {
    permissionError = new Error("permission storage unavailable"); await execute(); assert.equal(requests.length, 0); assert.equal(runs.size, 0); assert.equal(terminal()[0].error, "permission storage unavailable"); assert.equal(terminal()[0].conversationId, "chat");
  });
  test("missing credentials clean up the created run and checkpoint", async () => {
    apiKey = undefined; await execute(); assert.equal(requests.length, 0); assert.match(String(terminal()[0].error), /Open Settings -> API Key/); assert.deepEqual(deleted, ["chat"]); assert.equal(runs.size, 0);
  });
  test("a provider failure before content persists an error and publishes one terminal event", async () => {
    mode = "error"; await execute(); const messages = latestState.getConversation()!.messages;
    assert.ok(messages.some((message) => message.role === "error" && message.content.includes("provider unavailable"))); assert.equal(terminal().length, 1); assert.equal(terminal()[0].type, "streamError"); assert.equal(runs.size, 0);
  });
  test("partial provider failures preserve the visible answer with error status", async () => {
    mode = "partial-error"; await execute(); const messages = latestState.getConversation()!.messages;
    const assistant = messages.find((message) => message.role === "assistant"); assert.equal(assistant?.content, "Answer"); assert.equal(assistant?.generationStatus, "error"); assert.ok(messages.some((message) => message.role === "error")); assert.equal(terminal().length, 1); assert.equal(runs.size, 0);
  });
  for (const reason of ["user_cancelled", "steered"] as const) {
    test(`partial ${reason} preserves the answer and its stop reason`, async () => {
      mode = "partial-cancel"; stopReason = reason; await execute(); const assistant = latestState.getConversation()!.messages.find((message) => message.role === "assistant");
      assert.equal(assistant?.content, "Answer"); assert.equal(assistant?.generationStatus, reason === "user_cancelled" ? "cancelled" : "interrupted"); assert.equal(assistant?.generationStopReason, reason); assert.equal(terminal().length, 1); assert.equal(terminal()[0].generationStopReason, reason); assert.equal(runs.size, 0);
    });
  }
  test("cancellation before content still records a cancelled assistant turn", async () => {
    mode = "cancel"; await execute(); const assistant = latestState.getConversation()!.messages.find((message) => message.role === "assistant"); assert.equal(assistant?.generationStatus, "cancelled"); assert.equal(assistant?.content, ""); assert.equal(terminal().length, 1);
  });
  function toolResponse(name: string, handler: (context: ToolHandlerContext) => Promise<string>) {
    registry.register({ definition: { type: "function", function: { name, description: "Test operation", parameters: { type: "object", properties: {} } } },
      metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "read-only" }, handler: async (_args, context) => handler(context!) });
    let first = true;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.tool_choice === "none") { return Response.json({ id: "review", choices: [{ message: { role: "assistant", content: '{"decision":"complete","reason":"done"}' }, finish_reason: "stop" }] }); }
      const delta = first ? { tool_calls: [{ index: 0, id: "call", type: "function", function: { name, arguments: "{}" } }] } : { content: "Tool answer", reasoning_content: "Final reasoning" };
      const finish_reason = first ? "tool_calls" : "stop"; first = false;
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
  }
  test("tool-enabled generations persist tool outcomes and a single completed assistant", async () => {
    let calls = 0; toolResponse("lookup", async () => { calls++; return "lookup result"; }); await execute();
    assert.equal(calls, 1); assert.equal(requests.length, 0); const assistant = latestState.getConversation()!.messages.find((message) => message.role === "assistant");
    assert.equal(latestState.getApiMessages().filter(message => message.role === "assistant")[0].reasoning_content, "Final reasoning");
    assert.equal(assistant?.content, "Tool answer"); assert.equal(assistant?.generationStatus, "completed"); assert.equal(assistant?.toolCalls?.[0].status, "completed"); assert.equal(terminal().length, 1); assert.equal(runs.size, 0);
  });
  test("revert requests in incognito mode return the explicit recovery-unavailable error", async () => {
    toolResponse("revert_workspace", async (context) => context.revertWorkspace!()); await execute();
    const assistant = latestState.getConversation()!.messages.find((message) => message.role === "assistant");
    assert.equal(assistant?.toolCalls?.[0].status, "error"); assert.match(assistant!.toolCalls![0].result!, /Persistent recovery snapshots are unavailable in incognito mode/); assert.equal(runs.size, 0);
  });
  test("persistent image reopening requires explicit saved image numbers", async () => {
    config.historyEnabled = true; state.reset("persistent");
    toolResponse("view_image", async (context) => context.analyzeImages!({ question: "Inspect the saved screenshot" })); await execute();
    const saved = await history.getById("chat"); const assistant = saved?.messages.find((message) => message.role === "assistant");
    assert.equal(assistant?.toolCalls?.[0].status, "error"); assert.match(assistant!.toolCalls![0].result!, /Specify the saved conversation image numbers/);
  });

  test("persistent tool contexts read saved instructions and preserve capture and application-session failures", async () => {
    config.historyEnabled = true; state.reset("persistent");
    await mkdir(path.join(root, "instructions"));
    await writeFile(path.join(root, "instructions/guide.md"), '---\ndescription: "Project guide"\n---\nUse this saved instruction.');
    let checked = false;
    toolResponse("inspect_context", async context => {
      const instruction = JSON.parse(await context.readInstruction!("global:guide"));
      assert.match(instruction.content, /Use this saved instruction/);
      await assert.rejects(context.readInstruction!("global:missing"), /not in the current catalog/);
      await assert.rejects(context.applicationSession!({ action: "status", session_id: "missing" }), /session/i);
      await assert.rejects(context.captureScreenshot!({ target: "web", url: "invalid-url" }), /No web capture backend/);
      checked = true; return "Context checked";
    });
    await execute();
    const saved = await history.getById("chat"); const assistant = saved?.messages.find(message => message.role === "assistant");
    assert.equal(checked, true, assistant?.toolCalls?.[0].result);
    assert.equal(assistant?.toolCalls?.[0].status, "completed"); assert.equal(assistant?.toolCalls?.[0].result, "Context checked");
    assert.equal(terminal().length, 1); assert.equal(runs.size, 0);
  });

  test("persistent conversations archive images and save the completed turn to disk", async () => {
    config.historyEnabled = true; state.reset("persistent"); await execute(); assert.deepEqual(archived, ["chat"]);
    const saved = await history.getById("chat"); assert.equal(saved?.messages.find((message) => message.role === "assistant")?.content, "Answer"); assert.equal(runs.size, 0);
  });
  test("preserves explicitly selected instruction content in the stored user context", async () => {
    await mkdir(path.join(root, "instructions"));
    await writeFile(path.join(root, "instructions/guide.md"), '---\ndescription: "Project guide"\n---\nFollow the selected project convention.');
    await execute({ text: "Use ./instructions/guide.md for this task" });
    const user = latestState.getConversation()!.messages.find(message => message.role === "user");
    assert.equal(user?.content, "Use ./instructions/guide.md for this task");
    assert.match(user?.contextContent ?? "", /Follow the selected project convention/);
    assert.ok(JSON.stringify(requests[0].messages).includes("Follow the selected project convention"));
    assert.equal(terminal().length, 1); assert.equal(terminal()[0].status, "completed");
  });
  test("preserves completed UI edits and the final answer when automatic capture is unavailable", async () => {
    config.historyEnabled = true; state.reset("persistent"); let edits = 0;
    toolResponse("edit_file", async () => {
      edits++;
      await new ScreenshotStore("chat").save(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
        { kind: "web", target: "http://localhost:3000", captureRequest: { target: "web", url: "http://localhost:3000" } });
      return JSON.stringify({ type: "fileEdit", path: "App.tsx", content: "Updated UI" });
    });
    await execute();
    const saved = await history.getById("chat"); const assistant = saved?.messages.find(message => message.role === "assistant");
    assert.equal(edits, 1); assert.equal(assistant?.content, "Tool answer"); assert.equal(assistant?.generationStatus, "completed");
    assert.equal(assistant?.toolCalls?.find(call => call.toolName === "edit_file")?.status, "completed");
    const capture = assistant?.toolCalls?.find(call => call.toolName === "capture_screenshot");
    assert.ok(capture); assert.match(capture.result ?? "", /Automatic capture unavailable.*No web capture backend/);
    assert.equal((await new ScreenshotStore("chat").list()).length, 1);
    assert.equal(terminal().length, 1); assert.equal(terminal()[0].status, "completed"); assert.equal(runs.size, 0);
  });
  test("persists tool-cycle compaction metadata and continues to one completed answer", async () => {
    config.historyEnabled = true; state.reset("persistent");
    toolResponse("compact_context", async () => "Compaction requested");
    await execute({ text: "Keep the requested behavior and completed work. ".repeat(1000) });
    const saved = await history.getById("chat"); assert.ok(saved);
    assert.ok(saved.contextSummary?.boundaries?.some(boundary => boundary.reason === "tool_cycle_rollover"));
    assert.ok(saved.messages.some(message => message.role === "context" && message.content === "Context automatically compacted"));
    assert.equal(saved.messages.find(message => message.role === "assistant")?.content, "Tool answer");
    assert.equal(terminal().length, 1); assert.equal(terminal()[0].status, "completed"); assert.equal(runs.size, 0);
  });
});

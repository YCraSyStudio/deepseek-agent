import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type ChatMessage, type PermissionSnapshot, type StoredToolCall } from "@/contracts";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { ToolCallSession } from "@/vscode/webviews/handlers/chat/toolCalls/ToolCallSession";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import { ConversationState } from "@/application/chat/ConversationState";
import { isConversation } from "@/application/chat/ConversationValidation";
import { createAutomaticCaptureSession } from "@/infrastructure/capture/AutomaticCaptureSession";
import { createNativeCaptureImages } from "@/infrastructure/deepseek/provider/NativeCaptureImages";
import { captureScreenshotTool } from "@/infrastructure/tools/builtins/vision/CaptureScreenshot";
import type { ScreenshotStore, ScreenshotMetadata } from "@/infrastructure/images/ScreenshotStore";

const edited: StoredToolCall = { toolCallId: "edit", toolName: "edit_file", arguments: "{}", status: "completed", result: '{"type":"fileEdit","path":"main.css"}' };
const target = { id: "screenshot-1", kind: "web", target: "http://127.0.0.1:4321/docs/", width: 800, height: 600 } as ScreenshotMetadata;
const snapshot: PermissionSnapshot = { permissionMode: "auto-approve", revision: 1, workspaceTrusted: true, fingerprint: "test" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

suite("Automatic captures within the active tool cycle", () => {
  const originalFetch = globalThis.fetch;
  teardown(() => {globalThis.fetch = originalFetch;});

  for (const model of ["deepseek-flash", "deepseek-v4-pro"]) {
    test(`${model} inspects the automatic capture before stopping the preview and writing its final answer`, async () => {
      let previewAlive = true; let captures = 0; let inspections = 0; let requests = 0; let uploads = 0;
      const deleted: string[] = [];
      const screenshots = { list: async () => [target, { ...target, id: "screenshot-3", kind: "attachment" }], automaticCount: async () => 0,
        lookup: async (id: string) => ({ bytes: png, metadata: { id, fileName: `${id}.png` } }) } as unknown as ScreenshotStore;
      const config = { ...DEFAULT_CONFIG, model, apiKey: "test", thinkingMode: false };
      const native = createNativeCaptureImages({ config, screenshots,
        upload: async ({ bytes }) => {assert.deepEqual(bytes, png); uploads++; return { id: "file-api-auto", filename: "capture.png", bytes: png.length, createdAt: 1 };},
        deleteFile: async ({ fileId }) => {deleted.push(fileId);},
      });
      const prepare = createAutomaticCaptureSession({ screenshots,
        capture: async request => {
          assert.equal(previewAlive, true, "Capture must precede application_session stop");
          assert.equal(request.url, target.target); captures++;
          return { id: "screenshot-4", path: ".screenshots/4-web.png", kind: "web", target: request.url!, width: 800, height: 600, bytes: png.length };
        },
        inspect: async capture => {
          inspections++;
          if (native) {await native.add(capture.id); return undefined;}
          return "The page heading is visible and the layout is rendered.";
        },
      });
      const registry = new ToolRegistry();
      const metadata = { scope: "global", effect: "read-only", dangerLevel: "safe", requiresConfirmation: false } as const;
      registry.register({ definition: { type: "function", function: { name: "edit_file", parameters: { type: "object", properties: {} } } }, metadata,
        handler: async () => edited.result! });
      registry.register({ definition: { type: "function", function: { name: "application_session", parameters: { type: "object", properties: { action: { type: "string" } } } } }, metadata,
        handler: async () => {assert.equal(captures, 1); previewAlive = false; return '{"status":"stopped"}';} });
      registry.register(captureScreenshotTool);
      const events: Record<string, unknown>[] = [];
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (!body.stream) {return Response.json({ choices: [{ message: { role: "assistant", content: '{"decision":"complete","reason":"done"}' }, finish_reason: "stop" }] });}
        requests++;
        const calls = requests === 1 ? [
          { index: 0, id: "edit", type: "function", function: { name: "edit_file", arguments: "{}" } },
          { index: 1, id: "stop", type: "function", function: { name: "application_session", arguments: '{"action":"stop"}' } },
        ] : undefined;
        if (requests === 2) {
          assert.equal(captures, 1); assert.equal(inspections, 1); assert.equal(previewAlive, false);
          const visualIds = (body.messages as ChatMessage[]).flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === "file").map(part => part.file_id) : []);
          if (native) {assert.deepEqual(visualIds, ["file-api-auto"]);}
          else {assert.ok(JSON.stringify(body.messages).includes("The page heading is visible")); assert.deepEqual(visualIds, []);}
          const automaticCall = (body.messages as ChatMessage[]).flatMap(message => message.tool_calls ?? []).find(call => call.id.startsWith("auto-capture-"));
          assert.ok(automaticCall); assert.deepEqual(JSON.parse(automaticCall.function.arguments), { target: "web", url: target.target, width: 800, height: 600 });
        }
        const data = { choices: [{ index: 0, delta: calls ? { role: "assistant", tool_calls: calls } : { role: "assistant", content: "The captured page is rendered correctly." }, finish_reason: calls ? "tool_calls" : "stop" }] };
        return new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      };
      try {
        const result = await new ToolCallSession(new ToolExecutor(registry)).run({
          messages: [{ role: "user", content: "Edit the CSS and inspect the page" }], tools: registry.getDefinitionsForAPI(), providerConfig: config,
          eventSink: { publish: event => {events.push(event);} }, permissionSnapshot: snapshot, capturePermissionSnapshot: async () => snapshot,
          exposeReasoning: false, isCancelling: () => false, isWorkspaceTrusted: () => true, generationId: "test", conversationId: "test",
          trustedUserRequest: "Edit the CSS and inspect the page", authorizedUserUrls: [], budgetManager: new GenerationBudgetManager(model, config.maxTokens),
          prepareNativeImages: native?.prepare, prepareAutomaticCapture: prepare,
        });
        assert.ok(result, JSON.stringify(events)); assert.equal(result.partial, false, JSON.stringify(events));
        assert.equal(requests, 2); assert.equal(captures, 1); assert.equal(result.timeline.at(-1)?.type, "content");
        assert.ok(result.toolCalls?.some(call => call.toolCallId.startsWith("auto-capture-") && call.round === 1 && call.status === "completed"));
        const state = new ConversationState({ save: async conversation => {assert.equal(isConversation(conversation), true);} });
        await state.saveTurn({ model, userMessage: state.createMessage("user", "Inspect"), assistantMessage: state.createMessage("assistant", result.content,
          { timeline: result.timeline, toolCalls: result.toolCalls, providerTranscript: result.providerTranscript }) });
      } finally {await native?.dispose();}
      assert.equal(uploads, native ? 1 : 0); assert.deepEqual(deleted, native ? ["file-api-auto"] : []);
    });
  }

  test("retries only after new successful UI mutations, with no invented capture target", async () => {
    let captures = 0;
    const prepare = createAutomaticCaptureSession({ screenshots: { list: async () => [], automaticCount: async () => 0 },
      capture: async () => {captures++; throw new Error("Must not capture without a target");} });
    assert.equal(prepare([{ ...edited, status: "rejected" }]), undefined);
    const attempt = prepare([edited]); assert.ok(attempt);
    assert.match((await attempt()).content, /No known running UI target/);
    assert.equal(prepare([edited]), undefined); assert.equal(captures, 0);
    assert.ok(prepare([edited, { ...edited, toolCallId: "next-edit" }]));
  });
});

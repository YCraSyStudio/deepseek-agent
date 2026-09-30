import assert from "node:assert/strict";
import { captureScreenshotTool, validateCaptureRequest } from "@/infrastructure/tools/builtins/vision/CaptureScreenshot";
import { CaptureService, type CaptureBackend } from "@/infrastructure/capture/CaptureService";
import type { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { executeToolCall } from "@/vscode/webviews/handlers/chat/toolCalls/ToolExecution";
import { createExecutionContext, createToolExecutorStub, toolCall } from "../chat/executionHarness";

suite("capture screenshot tool", () => {
  test("rejects ambiguous targets, unsafe URLs and invalid dimensions", () => {
    for (const args of [{ target: "other" }, { target: "web", url: "file:///secret" }, { target: "window" }, { target: "web", url: "http://localhost", width: 50000 }, { target: "debug", wait_ms: -1 }]) {
      assert.throws(() => validateCaptureRequest(args));
    }
  });
  test("returns metadata only and publishes a local capture event", async () => {
    const events: unknown[] = [];
    const store = { save: async () => ({ id: "screenshot-1", fileName: "1-web.png", kind: "web", target: "http://localhost", width: 800, height: 600, bytes: 100 }) } as unknown as ScreenshotStore;
    const runner: CaptureBackend = { capture: async () => ({ bytes: Buffer.from("fake"), target: "http://localhost" }) };
    const service = new CaptureService(store, (event) => {events.push(event);}, new Map([["web", runner]]));
    const result = await captureScreenshotTool.handler({ target: "web", url: "http://localhost" }, { captureScreenshot: service.capture.bind(service) });
    assert.equal(JSON.parse(result).id, "screenshot-1");
    assert.equal(JSON.parse(result).path, ".screenshots/1-web.png");
    assert.ok(!result.includes("base64")); assert.equal(events.length, 1);
  });
  test("bounded timeout aborts the runner and stores no image", async () => {
    let signal: AbortSignal | undefined;
    const runner: CaptureBackend = { capture: async (_request, input) => {signal = input; return new Promise(() => undefined);} };
    const service = new CaptureService({ save: async () => {assert.fail("must not store");} } as unknown as ScreenshotStore, undefined, new Map([["web", runner]]), 5);
    await assert.rejects(service.capture({ target: "web", url: "http://localhost" }), /timed out/);
    assert.equal(signal?.aborted, true);
  });
  for (const mode of ["auto-approve", "full-access"] as const) {
    test(`whole display always requires explicit confirmation in ${mode}`, async () => {
      const { executor, forcedCalls } = createToolExecutorStub({ metadata: { capture_screenshot: captureScreenshotTool.metadata },
        confirmation: JSON.stringify({ requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "Capture display?" }) });
      const context = createExecutionContext({ executor, permissionMode: mode });
      await executeToolCall(toolCall("capture_screenshot", { target: "screen" }), context.context);
      assert.equal(context.confirmations(), 1); assert.equal(context.reviews(), 0); assert.equal(forcedCalls.length, 0);
    });
  }
});

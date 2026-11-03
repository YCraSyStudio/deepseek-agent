import assert from "node:assert/strict";
import { mock } from "node:test";
import { act, createElement } from "react";
import { ScreenshotPreview } from "@webview/components/chatView/tools/results/ScreenshotPreview";
import ToolCallTimeline from "@webview/components/chatView/tools/timeline/ToolCallTimeline";
import type { VsCodeApi } from "@webview/VsCodeApi";
import { createDomHarness } from "../../../../support/DomHarness";

suite("screenshot preview lifecycle", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let api: VsCodeApi;
  setup(async () => {
    h = await createDomHarness(); api = { postMessage: (post) => h.posts.push(post as Record<string, unknown>), getState: () => undefined, setState: (value) => value };
  });
  teardown(async () => { mock.timers.reset(); await h.dispose(); });
  const render = (id = "screenshot-1") => h.render(createElement(ScreenshotPreview, { id, conversationId: "chat-1", vscode: api }));

  test("requests its own screenshot and ignores other request IDs or conversations", async () => {
    await render(); const request = h.last("getScreenshotPreview");
    assert.equal(request.screenshotId, "screenshot-1"); assert.equal(request.conversationId, "chat-1");
    await h.message({ type: "screenshotPreview", requestId: "old", conversationId: "chat-1", uri: "wrong.png" });
    await h.message({ type: "screenshotPreview", requestId: request.requestId, conversationId: "other", uri: "wrong.png" });
    assert.equal(h.container.querySelector("img"), null); assert.match(h.container.textContent!, /Loading screenshot/);
    await h.message({ type: "screenshotPreview", requestId: request.requestId, conversationId: "chat-1", uri: "data:image/png;base64,AA==", metadata: { target: "https://example.com", windowTitle: "Example window", width: 1280, height: 720 } });
    assert.equal(h.query("img").getAttribute("alt"), "https://example.com"); assert.match(h.query("figcaption").textContent!, /Example window · 1280 × 720/);
    await h.click("button"); const open = h.last("openScreenshot"); assert.equal(open.screenshotId, "screenshot-1"); assert.equal(open.conversationId, "chat-1");
  });

  test("missing metadata falls back to the screenshot ID and deleted images report an error", async () => {
    await render(); const request = h.last("getScreenshotPreview");
    await h.message({ type: "screenshotPreview", requestId: request.requestId, conversationId: "chat-1", uri: "data:image/png;base64,AA==" });
    assert.equal(h.query("img").getAttribute("alt"), "screenshot-1"); assert.equal(h.query("figcaption").textContent, "screenshot-1");
    await act(async () => { h.query("img").dispatchEvent(new h.dom.window.Event("error")); });
    assert.equal(h.container.querySelector("img"), null); assert.match(h.container.textContent!, /deleted or is unavailable/);
  });

  test("retargeting a preview removes the old listener and resets its image", async () => {
    await render(); const first = h.last("getScreenshotPreview");
    await h.message({ type: "screenshotPreview", requestId: first.requestId, conversationId: "chat-1", uri: "old.png", metadata: { target: "Page", width: 10, height: 20 } });
    assert.match(h.query("figcaption").textContent!, /Page/);
    await render("screenshot-2"); assert.equal(h.container.querySelector("img"), null);
    await h.message({ type: "screenshotPreview", requestId: first.requestId, conversationId: "chat-1", uri: "old.png" }); assert.equal(h.container.querySelector("img"), null);
    const second = h.last("getScreenshotPreview");
    await h.message({ type: "screenshotPreview", requestId: second.requestId, conversationId: "chat-1", error: "Capture expired" });
    assert.match(h.container.textContent!, /Capture expired/);
  });

  test("an unanswered preview times out without leaving an infinite loading state", async () => {
    mock.timers.enable({ apis: ["setTimeout"] }); await render();
    await act(async () => { mock.timers.tick(10_000); });
    assert.match(h.container.textContent!, /Screenshot unavailable/);
  });

  for (const result of [{ uri: "loaded.png" }, { error: "Capture expired" }]) {
    test(`the timeout preserves an already resolved ${"uri" in result ? "image" : "error"}`, async () => {
      mock.timers.enable({ apis: ["setTimeout"] }); await render(); const request = h.last("getScreenshotPreview");
      await h.message({ type: "screenshotPreview", requestId: request.requestId, conversationId: "chat-1", ...result });
      await act(async () => { mock.timers.tick(10_000); });
      if ("uri" in result) { assert.equal(h.query("img").getAttribute("src"), "loaded.png"); }
      else { assert.match(h.container.textContent!, /Capture expired/); }
    });
  }

  test("capture tools surface preview requests through the actual timeline", async () => {
    await h.render(createElement(ToolCallTimeline, { conversationId: "chat-1", vscode: api, groups: [{ id: "group", round: 1, expanded: true,
      toolCalls: [{ toolCallId: "capture", toolName: "capture_screenshot", arguments: "{}", status: "completed", round: 1, result: '{"id":"screenshot-5"}' }] }] }));
    assert.equal(h.last("getScreenshotPreview").screenshotId, "screenshot-5");
  });
});

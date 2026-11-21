import assert from "node:assert/strict";
import { screenshotReferences } from "@webview/components/chatView/tools/results/ScreenshotReferences";
import { isWebviewToHandlerMessage } from "@/vscode/webviews/WebviewMessageValidation";
suite("Screenshot timeline", () => {
  test("resolves capture and analyzed references from persisted tool events", () => {
    assert.deepEqual(screenshotReferences("capture_screenshot", '{"id":"screenshot-1"}'), ["screenshot-1"]);
    assert.deepEqual(screenshotReferences("analyze_images", 'Images sent: ["screenshot:screenshot-1","screenshot:screenshot-1","attachment:x"]\nAnalysis'), ["screenshot-1"]);
    assert.deepEqual(screenshotReferences("analyze_images", 'Images sent: ["screenshot:../../secret"]\ntext'), []);
    assert.deepEqual(screenshotReferences("capture_screenshot", 'Error: failed'), []);
    assert.deepEqual(screenshotReferences("other", '{"id":"screenshot-1"}'), []);
  });
  test("preview protocol permits only conversation ids and screenshot ids, never arbitrary paths", () => {
    const request = { type: "getScreenshotPreview", requestId: "r", conversationId: "conversation-1", screenshotId: "screenshot-1" };
    assert.equal(isWebviewToHandlerMessage(request), true);
    assert.equal(isWebviewToHandlerMessage({ ...request, conversationId: "../outside" }), false);
    assert.equal(isWebviewToHandlerMessage({ ...request, screenshotId: "../../secret" }), false);
    assert.equal(isWebviewToHandlerMessage({ ...request, path: "/private" }), false);
  });
});

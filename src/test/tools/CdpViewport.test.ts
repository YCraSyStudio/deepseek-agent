import assert from "node:assert/strict";
import { captureCdpViewport, connectCdpProxy, waitForCapture, type CdpConnection } from "@/infrastructure/capture/CdpViewport";
import { runCaptureHelper } from "@/infrastructure/capture/HelperProcess";
suite("Web viewport capture", () => {
  test("captures just the requested page viewport, with bounded background paint", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const connection: CdpConnection = { close() {}, async request(method, params) {calls.push({ method, params }); return method === "Page.captureScreenshot" ? { data: Buffer.from("png").toString("base64") } : {};} };
    assert.equal((await captureCdpViewport(connection, { target: "web", url: "http://localhost", width: 800, height: 600 }, new AbortController().signal)).toString(), "png");
    assert.equal(calls[1].params?.width, 800);
    assert.equal(calls[1].params?.deviceScaleFactor, 1);
    assert.equal(calls.at(-1)?.params?.captureBeyondViewport, false);
    assert.match(String(calls[2].params?.expression), /setTimeout/);
  });
  test("reports page-side load failure instead of capturing an unpainted page", async () => {
    let captured = false;
    const connection: CdpConnection = { close() {}, async request(method) {
      if (method === "Page.captureScreenshot") {captured = true;}
      return method === "Runtime.evaluate" ? { exceptionDetails: { text: "timeout" } } : {};
    }};
    await assert.rejects(captureCdpViewport(connection, { target: "web", url: "http://localhost" }, new AbortController().signal), /first paint/);
    assert.equal(captured, false);
  });
  test("refuses a proxy outside the owned loopback endpoint", async () => {
    await assert.rejects(connectCdpProxy({ host: "example.com", port: 9222, path: "/target" }, new AbortController().signal), /Invalid/);
  });
  test("cancellation stops delays and helper processes", async () => {
    const controller = new AbortController(); const waiting = waitForCapture(10000, controller.signal);
    controller.abort(); await assert.rejects(waiting, /cancelled/);
    const running = new AbortController(); const helper = runCaptureHelper(process.execPath, ["-e", "setInterval(() => {}, 1000)"], running.signal);
    running.abort(); await assert.rejects(helper);
    await assert.rejects(runCaptureHelper(process.execPath, ["-e", "setInterval(() => {}, 1000)"], new AbortController().signal, 20), /timed out/);
  });
});

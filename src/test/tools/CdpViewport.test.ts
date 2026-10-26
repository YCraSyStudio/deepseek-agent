import assert from "node:assert/strict";
import { captureCdpViewport, waitForCapture, type CdpConnection } from "@/infrastructure/capture/CdpViewport";
import { runCaptureHelper } from "@/infrastructure/capture/HelperProcess";
suite("Web viewport capture", () => {
  test("captures just the requested page viewport, with bounded background paint", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const connection: CdpConnection = { close() {}, async request(method, params) {
      calls.push({ method, params });
      if (method === "Page.captureScreenshot") {return { data: Buffer.from("png").toString("base64") };}
      if (method === "Page.getLayoutMetrics") {return { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } };}
      return params?.returnByValue ? { result: { value: { width: 800, height: 600, scale: 1 } } } : {};
    } };
    assert.equal((await captureCdpViewport(connection, { target: "web", url: "http://localhost", width: 800, height: 600 }, new AbortController().signal)).toString(), "png");
    assert.match(String(calls[1].params?.expression), /document.readyState/);
    assert.equal(calls[2].method, "Emulation.setDeviceMetricsOverride");
    assert.equal(calls[2].params?.width, 800);
    assert.equal(calls[2].params?.deviceScaleFactor, 1);
    const capture = calls.find((call) => call.method === "Page.captureScreenshot")!;
    assert.equal(capture.params?.captureBeyondViewport, true);
    assert.deepEqual(capture.params?.clip, { x: 0, y: 0, width: 800, height: 600, scale: 1 });
    assert.equal(calls.at(-1)?.method, "Page.getLayoutMetrics");
  });
  test("rejects editor-sized layouts and viewport changes during capture", async () => {
    for (const changesDuringCapture of [false, true]) {
      let captured = false;
      const connection: CdpConnection = { close() {}, async request(method, params) {
        if (method === "Page.captureScreenshot") {captured = true; return { data: "cG5n" };}
        if (method === "Page.getLayoutMetrics") {return { cssLayoutViewport: { clientWidth: changesDuringCapture && !captured ? 1440 : 984, clientHeight: 900 } };}
        if (params?.returnByValue) {
          return { result: { value: { width: changesDuringCapture && !captured ? 1440 : 984, height: 900, scale: 1 } } };
        }
        return {};
      } };
      await assert.rejects(captureCdpViewport(connection, { target: "web", url: "http://localhost", width: 1440, height: 900 }, new AbortController().signal), /viewport.*1440x900.*984x900.*discarded/);
      assert.equal(captured, changesDuringCapture);
    }
  });
  test("rejects a smaller CSS layout even when window metrics report the requested size", async () => {
    const connection: CdpConnection = { close() {}, async request(method, params) {
      assert.notEqual(method, "Page.captureScreenshot");
      if (method === "Page.getLayoutMetrics") {return { cssLayoutViewport: { clientWidth: 984, clientHeight: 900 } };}
      return params?.returnByValue ? { result: { value: { width: 1440, height: 900, scale: 1 } } } : {};
    } };
    await assert.rejects(captureCdpViewport(connection, { target: "web", url: "http://localhost", width: 1440, height: 900 }, new AbortController().signal), /CSS layout 984x900.*discarded/);
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
  test("cancellation stops delays and helper processes", async () => {
    const controller = new AbortController(); const waiting = waitForCapture(10000, controller.signal);
    controller.abort(); await assert.rejects(waiting, /cancelled/);
    const running = new AbortController(); const helper = runCaptureHelper(process.execPath, ["-e", "setInterval(() => {}, 1000)"], running.signal);
    running.abort(); await assert.rejects(helper);
    await assert.rejects(runCaptureHelper(process.execPath, ["-e", "setInterval(() => {}, 1000)"], new AbortController().signal, 20), /timed out/);
  });
});

import type { CaptureScreenshotRequest } from "@/contracts/Capture";

export interface CdpConnection {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  on?(method: string, listener: (params: Record<string, unknown>) => void): () => void;
  close(): void;
}
export async function captureCdpViewport(connection: CdpConnection, request: CaptureScreenshotRequest, signal: AbortSignal): Promise<Buffer> {
  const width = request.width ?? 1280;
  const height = request.height ?? 720;
  await connection.request("Page.enable");
  await waitForPaint(connection);
  signal.throwIfAborted();
  // Apply after navigation settles, then verify that the host honored the override.
  await connection.request("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height,
    deviceScaleFactor: 1, mobile: false, dontSetVisibleSize: false });
  await waitForPaint(connection);
  if (request.wait_ms) {await waitForCapture(request.wait_ms, signal);}
  signal.throwIfAborted();
  await assertViewport(connection, width, height);
  // A larger screenshot clip alone does not resize the page's CSS layout.
  const response = await connection.request("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 } });
  signal.throwIfAborted();
  await assertViewport(connection, width, height);
  if (typeof response.data !== "string" || response.data.length > 24 * 1024 * 1024) {throw new Error("CDP returned an invalid or oversized screenshot");}
  return Buffer.from(response.data, "base64");
}

async function assertViewport(connection: CdpConnection, width: number, height: number): Promise<void> {
  const metrics = await connection.request("Runtime.evaluate", {
    expression: "({width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio})", returnByValue: true,
  });
  const result = metrics.result as { value?: { width?: number; height?: number; scale?: number } } | undefined;
  const actual = result?.value;
  const layoutMetrics = await connection.request("Page.getLayoutMetrics");
  const layout = layoutMetrics.cssLayoutViewport as { clientWidth?: number; clientHeight?: number } | undefined;
  // Scrollbars may consume a few CSS pixels; the layout must still match the requested viewport.
  const matches = (actualSize: unknown, expected: number) => typeof actualSize === "number" && actualSize <= expected && actualSize >= expected - 20;
  if (metrics.exceptionDetails || actual?.width !== width || actual.height !== height || actual.scale !== 1 ||
      !matches(layout?.clientWidth, width) || !matches(layout?.clientHeight, height)) {
    throw new Error(`Browser viewport does not match requested ${width}x${height} at scale 1; received ${actual?.width ?? "unknown"}x${actual?.height ?? "unknown"} at scale ${actual?.scale ?? "unknown"}, CSS layout ${layout?.clientWidth ?? "unknown"}x${layout?.clientHeight ?? "unknown"}. The image was discarded; do not diagnose page layout from it.`);
  }
}

async function waitForPaint(connection: CdpConnection): Promise<void> {
  // Wait for page load/first paint using the target page, without scraping any other tab.
  const paint = await connection.request("Runtime.evaluate", { expression: `new Promise((resolve, reject) => {const deadline = setTimeout(() => reject(new Error('Page load timed out')), 7000); const paint = () => {clearTimeout(deadline); const fallback = setTimeout(resolve, 250); requestAnimationFrame(() => requestAnimationFrame(() => {clearTimeout(fallback); resolve();}));}; document.readyState === 'complete' ? paint() : window.addEventListener('load', paint, {once:true});})`, awaitPromise: true });
  if (paint.exceptionDetails) {throw new Error("Page failed to reach first paint before the loading deadline");}
}
export function waitForCapture(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer); reject(new Error("Capture cancelled"));};
    const timer = setTimeout(() => {signal.removeEventListener("abort", abort); resolve();}, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

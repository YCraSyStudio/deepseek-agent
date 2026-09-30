import type { CaptureScreenshotRequest } from "@/contracts/Capture";

export interface CdpConnection {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}
/** Connect only to the owned debug session's loopback proxy. No arbitrary CDP endpoint. */
export async function connectCdpProxy(address: { host: string; port: number; path: string }, signal: AbortSignal): Promise<CdpConnection> {
  if (!["127.0.0.1", "localhost", "::1"].includes(address.host) || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535 || !/^\/[a-zA-Z0-9_-]+$/.test(address.path)) {throw new Error("Invalid owned CDP proxy address");}
  signal.throwIfAborted();
  const socket = new WebSocket(`ws://${address.host === "::1" ? "[::1]" : address.host}:${address.port}${address.path}`);
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let id = 0; let closed = false;
  const close = () => {
    if (closed) {return;}
    closed = true;
    signal.removeEventListener("abort", abort);
    socket.close();
    for (const entry of pending.values()) {clearTimeout(entry.timer); entry.reject(new Error("CDP connection closed"));}
    pending.clear();
  };
  const abort = () => close();
  signal.addEventListener("abort", abort, { once: true });
  socket.addEventListener("close", close);
  socket.addEventListener("message", (event) => {
    const text = String(event.data);
    if (text.length > 24 * 1024 * 1024) {close(); return;}
    try {
      const response = JSON.parse(text);
      const entry = pending.get(response.id);
      if (!entry) {return;}
      pending.delete(response.id); clearTimeout(entry.timer);
      if (response.error) {entry.reject(new Error(`CDP request failed: ${String(response.error.message).slice(0, 300)}`));}
      else {entry.resolve(response.result ?? {});}
    } catch {close();}
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {close(); reject(new Error("CDP connection timed out"));}, 5000);
      const done = () => {clearTimeout(timer); signal.removeEventListener("abort", cancelled); socket.removeEventListener("close", disconnected);};
      const cancelled = () => {done(); reject(new Error("CDP connection cancelled"));};
      const disconnected = () => {done(); reject(new Error("CDP connection closed before opening"));};
      socket.addEventListener("close", disconnected, { once: true });
      signal.addEventListener("abort", cancelled, { once: true });
      socket.addEventListener("open", () => {done(); resolve();}, { once: true });
      socket.addEventListener("error", () => {done(); reject(new Error("CDP connection failed"));}, { once: true });
    });
  } catch (error) {close(); throw error;}
  return {
    close,
    request(method, params = {}) {
      signal.throwIfAborted();
      if (closed) {throw new Error("CDP connection is closed");}
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {pending.delete(requestId); reject(new Error(`CDP ${method} timed out`));}, 10000);
        pending.set(requestId, { resolve, reject, timer });
        try {socket.send(JSON.stringify({ id: requestId, method, params }));}
        catch (error) {clearTimeout(timer); pending.delete(requestId); reject(error);}
      });
    },
  };
}
export async function captureCdpViewport(connection: CdpConnection, request: CaptureScreenshotRequest, signal: AbortSignal): Promise<Buffer> {
  await connection.request("Page.enable");
  await connection.request("Emulation.setDeviceMetricsOverride", { width: request.width ?? 1280, height: request.height ?? 720, deviceScaleFactor: 1, mobile: false });
  // Wait for page load/first paint using the target page, without scraping any other tab.
  const paint = await connection.request("Runtime.evaluate", { expression: `new Promise((resolve, reject) => {const deadline = setTimeout(() => reject(new Error('Page load timed out')), 7000); const paint = () => {clearTimeout(deadline); const fallback = setTimeout(resolve, 250); requestAnimationFrame(() => requestAnimationFrame(() => {clearTimeout(fallback); resolve();}));}; document.readyState === 'complete' ? paint() : window.addEventListener('load', paint, {once:true});})`, awaitPromise: true });
  if (paint.exceptionDetails) {throw new Error("Page failed to reach first paint before the loading deadline");}
  signal.throwIfAborted();
  if (request.wait_ms) {await waitForCapture(request.wait_ms, signal);}
  signal.throwIfAborted();
  const response = await connection.request("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof response.data !== "string" || response.data.length > 24 * 1024 * 1024) {throw new Error("CDP returned an invalid or oversized screenshot");}
  return Buffer.from(response.data, "base64");
}
export function waitForCapture(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer); reject(new Error("Capture cancelled"));};
    const timer = setTimeout(() => {signal.removeEventListener("abort", abort); resolve();}, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

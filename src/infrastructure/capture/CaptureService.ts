import type { CaptureScreenshotRequest, CaptureScreenshotResult } from "@/contracts/Capture";
import { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";

export interface CaptureFrame { bytes: Buffer; target: string; windowTitle?: string; pid?: number }
export interface CaptureBackend { capture(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> }
const backends = new Map<CaptureScreenshotRequest["target"], CaptureBackend>();
export function registerCaptureBackend(target: CaptureScreenshotRequest["target"], backend: CaptureBackend): void {backends.set(target, backend);}

export class CaptureService {
  constructor(private readonly store: ScreenshotStore, private readonly onCaptured?: (result: CaptureScreenshotResult) => Promise<void> | void,
    private readonly runners: ReadonlyMap<CaptureScreenshotRequest["target"], CaptureBackend> = backends, private readonly timeoutMs = 30_000) {}

  async capture(request: CaptureScreenshotRequest, signal?: AbortSignal, automatic?: { limit: number }): Promise<CaptureScreenshotResult> {
    signal?.throwIfAborted();
    const backend = this.runners.get(request.target);
    if (!backend) {throw new Error(`No ${request.target} capture backend is available on this host. Configure a supported local browser/window target.`);}
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {abort();}
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
      const abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason ?? new Error("Capture cancelled"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        if (controller.signal.aborted) {rejectAbort();}
        timeout = setTimeout(() => controller.abort(new Error("Capture backend timed out")), this.timeoutMs);
      });
      const frame = await Promise.race([backend.capture(request, controller.signal), abortPromise]);
      controller.signal.throwIfAborted();
      const metadata = await this.store.save(frame.bytes, { kind: request.target, target: frame.target,
        windowTitle: frame.windowTitle, pid: frame.pid, label: request.label, automatic: !!automatic, automaticLimit: automatic?.limit });
      const result: CaptureScreenshotResult = {
        id: metadata.id, path: `.screenshots/${metadata.fileName}`, target: metadata.target, kind: request.target,
        windowTitle: metadata.windowTitle, pid: metadata.pid, width: metadata.width, height: metadata.height, bytes: metadata.bytes,
      };
      await this.onCaptured?.(result);
      return result;
    } finally {
      if (timeout) {clearTimeout(timeout);}
      if (rejectAbort) {controller.signal.removeEventListener("abort", rejectAbort);}
      signal?.removeEventListener("abort", abort);
    }
  }
}

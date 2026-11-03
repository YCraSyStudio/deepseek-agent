import type { StoredToolCall } from "@/contracts";
import type { CaptureScreenshotRequest, CaptureScreenshotResult } from "@/contracts/Capture";
import type { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { automaticCapture, changedUiPaths, knownCaptureTarget } from "./AutomaticCapture";

export interface AutomaticCaptureObservation { content: string; request?: CaptureScreenshotRequest }

/** One capture attempt per new batch of completed UI mutations, before the next model request. */
export function createAutomaticCaptureSession(options: {
  screenshots: Pick<ScreenshotStore, "list" | "automaticCount">;
  unavailable?: string;
  capture(request: CaptureScreenshotRequest): Promise<CaptureScreenshotResult>;
  inspect?(capture: CaptureScreenshotResult): Promise<string | undefined>;
}) {
  const processed = new Set<string>();
  return (calls: readonly StoredToolCall[]): (() => Promise<AutomaticCaptureObservation>) | undefined => {
    const pending = calls.filter(call => !processed.has(call.toolCallId));
    const paths = changedUiPaths(pending);
    if (!paths.length) {return undefined;}
    for (const call of pending) {processed.add(call.toolCallId);}
    return async () => {
      // An uploaded attachment is an observation, not a running UI target.
      const latest = options.unavailable ? undefined : (await options.screenshots.list()).filter(image => image.kind !== "attachment").at(-1);
      const request = knownCaptureTarget(latest);
      const result = await automaticCapture({ enabled: true, paths,
        count: await options.screenshots.automaticCount().catch(() => 10), limit: 10,
        target: request, unavailable: options.unavailable, capture: options.capture });
      if (!result.capture) {return { request, content: result.note ?? "No automatic capture was needed" };}
      const visualAnalysis = await options.inspect?.(result.capture);
      return { request, content: JSON.stringify({ ...result.capture, ...(visualAnalysis ? { visualAnalysis } : {}) }) };
    };
  };
}

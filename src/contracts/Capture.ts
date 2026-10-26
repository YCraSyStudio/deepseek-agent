export interface CaptureScreenshotRequest {
  target: "web" | "window" | "debug" | "screen";
  url?: string; window?: string; process?: string;
  width?: number; height?: number; wait_ms?: number; label?: string;
}
export interface CaptureScreenshotResult {
  id: string; path: string; target: string; kind: CaptureScreenshotRequest["target"];
  windowTitle?: string; pid?: number; width: number; height: number; bytes: number;
}

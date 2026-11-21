import type { RegisteredTool, ToolHandlerContext } from "@/application/tools/Types";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";

export function validateCaptureRequest(args: Record<string, unknown>): CaptureScreenshotRequest {
  if (!["web", "window", "debug", "screen"].includes(String(args.target))) {throw new Error("target must be web, window, debug or screen");}
  for (const key of ["url", "window", "process", "label"]) {
    if (args[key] !== undefined && (typeof args[key] !== "string" || !(args[key] as string).trim() || (args[key] as string).length > 2048)) {throw new Error(`Invalid capture ${key}`);}
  }
  for (const key of ["width", "height", "wait_ms"]) {
    if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || Number(args[key]) < (key === "wait_ms" ? 0 : 1) || Number(args[key]) > (key === "wait_ms" ? 10_000 : 4096))) {throw new Error(`Invalid capture ${key}`);}
  }
  if (args.target === "web") {
    if (typeof args.url !== "string") {throw new Error("url is required for a web capture");}
    const url = new URL(args.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {throw new Error("Capture URL must be HTTP(S) without credentials");}
  }
  if (args.target === "window" && !args.window && !args.process) {throw new Error("Window capture requires a title or process selector; no window will be guessed");}
  return args as unknown as CaptureScreenshotRequest;
}
async function capture(args: Record<string, unknown>, context?: ToolHandlerContext): Promise<string> {
  const request = validateCaptureRequest(args);
  if (!context?.captureScreenshot) {return "Error: screenshot capture is unavailable in this conversation or host.";}
  return JSON.stringify(await context.captureScreenshot(request, context.signal));
}
export const captureScreenshotTool: RegisteredTool = {
  definition: { type: "function", function: { name: "capture_screenshot", strict: true,
    description: "Capture local UI output after changing layout, CSS, scenes or prefabs, before judging the visual result. Returns a screenshot id and metadata. Flash receives successful captures as native visual file parts in the next tool round; inspect those images directly. Pro must call analyze_images with screenshot_ids to inspect them. Inspect the actual image before judging UI; never infer image contents from metadata alone. The returned path is relative to this conversation's history storage, NOT the workspace: do not search workspace files for it. Use web with a running page URL; web captures run headlessly. For window/debug, first launch the application and identify its exact window or PID; a successful build alone does not start it. On Wayland, the desktop portal may require an initial window selection; remembered authorization is reused when supported. Title/PID cannot be selected or verified programmatically there; the result identifies a user-selected window without asserting its identity. Never retry a failed window capture through whole-screen capture. Screenshot permissions follow the user’s capture policy for every target.",
    parameters: { type: "object", properties: {
      target: { type: "string", enum: ["web", "window", "debug", "screen"] },
      url: { type: "string" }, window: { type: "string" }, process: { type: "string" }, label: { type: "string" },
      width: { type: "integer", minimum: 1, maximum: 4096 }, height: { type: "integer", minimum: 1, maximum: 4096 },
      wait_ms: { type: "integer", minimum: 0, maximum: 10000, description: "Optional web rendering wait, at most 10000 ms. For native startup use application_session status/wait_ms while keeping the application alive." },
    }, required: ["target"], additionalProperties: false },
  } },
  metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "read-only" },
  handler: capture,
  forcedHandler: capture,
};

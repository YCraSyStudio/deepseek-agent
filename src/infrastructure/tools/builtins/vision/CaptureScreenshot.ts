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
    description: "Capture local UI output after changing layout, CSS, scenes or prefabs, before judging the visual result. Returns only a stored screenshot id and metadata; call analyze_images with that id to inspect it. Use web with a URL for page content, window with an exact selector, or debug for the running app. Never guesses a target. Whole-screen capture requires user confirmation every time.",
    parameters: { type: "object", properties: {
      target: { type: "string", enum: ["web", "window", "debug", "screen"] },
      url: { type: "string" }, window: { type: "string" }, process: { type: "string" }, label: { type: "string" },
      width: { type: "integer", minimum: 1, maximum: 4096 }, height: { type: "integer", minimum: 1, maximum: 4096 },
      wait_ms: { type: "integer", minimum: 0, maximum: 10000 },
    }, required: ["target"], additionalProperties: false },
  } },
  metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "read-only",
    alwaysConfirmWhen: { argument: "target", values: ["screen"] } },
  handler: async (args, context) => {
    validateCaptureRequest(args);
    if (args.target === "screen") {return JSON.stringify({ requiresConfirmation: true, dangerLevel: "dangerous", warningMessage: "Capture the whole display? This can include unrelated private activity.", reasonCode: "always-confirm-screen-capture" });}
    return capture(args, context);
  },
  forcedHandler: capture,
};

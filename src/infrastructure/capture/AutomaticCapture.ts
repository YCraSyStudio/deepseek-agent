import type { StoredToolCall } from "@/contracts";
import type { CaptureScreenshotRequest, CaptureScreenshotResult } from "@/contracts/Capture";
import type { ScreenshotMetadata } from "@/infrastructure/images/ScreenshotStore";
const UI_PATH = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html|uxml|uss|unity|prefab|xaml|axaml|fxml)$/i;
const MUTATIONS = new Set(["create_file", "edit_file", "apply_patch", "move_path", "delete_path"]);
export function changedUiPaths(calls: readonly StoredToolCall[]): string[] {
  const paths = new Set<string>();
  for (const call of calls) {
    if (!MUTATIONS.has(call.toolName) || call.status !== "completed" || call.isError || !call.result) {continue;}
    try {
      const result = JSON.parse(call.result);
      if (!["fileWrite", "fileEdit", "filePatch", "fileMove", "fileDelete"].includes(result.type)) {continue;}
      for (const value of [result.path, result.source, result.destination]) {if (typeof value === "string" && UI_PATH.test(value)) {paths.add(value);}}
    } catch {continue;}
  }
  return [...paths];
}
export function knownCaptureTarget(latest?: ScreenshotMetadata): CaptureScreenshotRequest | undefined {
  if (!latest || latest.kind === "screen") {return undefined;}
  if (latest.kind === "web") {
    try {const url = new URL(latest.target); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {return { target: "web", url: latest.target, width: latest.width, height: latest.height };}} catch {return undefined;}
  }
  if (["window", "debug"].includes(latest.kind) && /^window:(0x[0-9a-f]+|\d+)$/i.test(latest.target) && latest.pid) {
    return { target: "window", window: latest.target.slice(7), process: String(latest.pid) };
  }
  return undefined;
}
export async function automaticCapture(options: {
  enabled: boolean; paths: string[]; count: number; limit: number; target?: CaptureScreenshotRequest;
  unavailable?: string; capture: (request: CaptureScreenshotRequest) => Promise<CaptureScreenshotResult>;
}): Promise<{ capture?: CaptureScreenshotResult; note?: string }> {
  if (!options.enabled || !options.paths.length) {return {};}
  if (options.unavailable) {return { note: options.unavailable };}
  if (options.count >= options.limit) {return { note: "Automatic capture limit reached for this conversation" };}
  if (!options.target) {return { note: "No known running UI target; capture a viewport or window explicitly first" };}
  try {return { capture: await options.capture(options.target) };}
  catch (error) {return { note: `Automatic capture unavailable: ${String(error).slice(0, 400)}` };}
}

import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend, CaptureFrame } from "./CaptureService";
import { runCaptureHelper } from "./HelperProcess";

export async function findSystemBrowser(): Promise<string | undefined> {
  const names = process.platform === "win32" ? ["chrome.exe", "msedge.exe"] : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  const candidates = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap((directory) => names.map((name) => path.join(directory, name)));
  if (process.platform === "darwin") {candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");}
  if (process.platform === "win32") {
    for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter((value): value is string => !!value)) {
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"), path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  }
  for (const candidate of candidates) {try {await access(candidate, constants.X_OK); return candidate;} catch {continue;}}
  return undefined;
}
export class SystemBrowserCapture implements CaptureBackend {
  async capture(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> {
    const binary = await findSystemBrowser();
    if (!binary) {throw new Error("No system Chrome/Chromium/Edge found. Install a supported browser or use local desktop VS Code with its integrated browser.");}
    const version = await runCaptureHelper(binary, ["--version"], signal, 5000);
    if (!/(Chrome|Chromium|Edge)\s+\d+/i.test(version.stdout)) {throw new Error("System browser does not identify as a supported Chromium build");}
    const temporary = await mkdtemp(path.join(tmpdir(), "ycrasy-web-capture-"));
    try {
      const screenshot = path.join(temporary, "viewport.png");
      await runCaptureHelper(binary, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        `--user-data-dir=${path.join(temporary, "profile")}`, `--screenshot=${screenshot}`,
        `--window-size=${request.width ?? 1280},${request.height ?? 720}`, `--virtual-time-budget=${Math.max(1000, request.wait_ms ?? 1000)}`, request.url!], signal, 25000);
      if ((await stat(screenshot)).size > 16 * 1024 * 1024) {throw new Error("Browser screenshot exceeds the size limit");}
      return { bytes: await readFile(screenshot), target: request.url! };
    } finally {await rm(temporary, { recursive: true, force: true });}
  }
}

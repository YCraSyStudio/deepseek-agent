import * as vscode from "vscode";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend, CaptureFrame } from "@/infrastructure/capture/CaptureService";
import type { SettingsRepository } from "@/application/ports";

export class WebCaptureBackend implements CaptureBackend {
  get timeoutMs(): number | undefined {return this.headless.timeoutMs;}
  private readonly allowedOrigins = new Set<string>();
  constructor(private readonly settings: SettingsRepository, private readonly headless: CaptureBackend) {}
  async capture(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> {
    signal.throwIfAborted();
    const origin = new URL(request.url!).origin;
    const access = this.settings.load().browserAccess;
    if (access === "never") {throw new Error("Browser access is disabled in agent settings");}
    if (access === "ask" && !this.allowedOrigins.has(origin)) {
      const response = await vscode.window.showInformationMessage(`Allow YCraSy Agent to load and capture ${origin} in a headless browser?`, { modal: true }, "Allow");
      signal.throwIfAborted();
      if (response !== "Allow") {throw new Error("Browser capture was not authorized");}
      this.allowedOrigins.add(origin);
    }
    return this.headless.capture(request, signal);
  }
}

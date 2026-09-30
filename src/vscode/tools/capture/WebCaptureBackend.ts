import { launchOwnedSession } from "@/infrastructure/capture/OwnedSessionLaunch";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend, CaptureFrame } from "@/infrastructure/capture/CaptureService";
import { connectCdpProxy, captureCdpViewport } from "@/infrastructure/capture/CdpViewport";
import { SystemBrowserCapture } from "@/infrastructure/capture/SystemBrowserCapture";
import type { SettingsRepository } from "@/application/ports";

export class WebCaptureBackend implements CaptureBackend {
  private readonly allowedOrigins = new Set<string>();
  constructor(private readonly settings: SettingsRepository, private readonly fallback: CaptureBackend = new SystemBrowserCapture()) {}
  async capture(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> {
    signal.throwIfAborted();
    const origin = new URL(request.url!).origin;
    const access = this.settings.load().browserAccess;
    if (access === "never") {throw new Error("Browser access is disabled in agent settings");}
    if (access === "ask" && !this.allowedOrigins.has(origin)) {
      const response = await vscode.window.showInformationMessage(`Allow YCraSy Agent to open and capture ${origin}?`, { modal: true }, "Allow");
      signal.throwIfAborted();
      if (response !== "Allow") {throw new Error("Browser capture was not authorized");}
      this.allowedOrigins.add(origin);
    }
    if (vscode.env.uiKind === vscode.UIKind.Desktop && !vscode.env.remoteName) {
      try {return await this.integrated(request, signal);} catch (error) {
        signal.throwIfAborted();
        try {return await this.fallback.capture(request, signal);} catch (fallbackError) {
          throw new Error(`Integrated browser capture unavailable: ${String(error).slice(0, 300)}. System browser: ${String(fallbackError).slice(0, 300)}`);
        }
      }
    }
    return this.fallback.capture(request, signal);
  }

  private async integrated(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> {
    const name = `YCraSy UI capture ${randomUUID()}`;
    const owned = await launchOwnedSession<vscode.DebugSession>({
      signal,
      subscribe: (onSession) => vscode.debug.onDidStartDebugSession((session) => {
        if (session.name === name && ["editor-browser", "pwa-editor-browser"].includes(session.type)) {onSession(session);}
      }),
      launch: () => vscode.debug.startDebugging(undefined, { type: "editor-browser", request: "launch", name, url: request.url, noDebug: false }),
      stop: (session) => vscode.debug.stopDebugging(session),
    });
    try {
      signal.throwIfAborted();
      const proxy = await owned.session.customRequest("requestCDPProxy") as { host: string; port: number; path: string };
      const connection = await connectCdpProxy(proxy, signal);
      try {return { bytes: await captureCdpViewport(connection, request, signal), target: request.url! };}
      finally {connection.close();}
    } finally {await owned.dispose();}
  }
}

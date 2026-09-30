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
    let owned: vscode.DebugSession | undefined;
    let subscription: vscode.Disposable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const started = new Promise<vscode.DebugSession>((resolve, reject) => {
        subscription = vscode.debug.onDidStartDebugSession((session) => {
          if (session.name === name && ["editor-browser", "pwa-editor-browser"].includes(session.type)) {owned = session; resolve(session);}
        });
        timer = setTimeout(() => reject(new Error("Integrated browser debug session did not start")), 8000);
        abort = () => reject(new Error("Browser capture cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      });
      // Attach a handler before startDebugging, so start rejection cannot orphan a rejected promise.
      void started.catch(() => undefined);
      const launch = vscode.debug.startDebugging(undefined, { type: "editor-browser", request: "launch", name, url: request.url, noDebug: false });
      const session = await Promise.race([started, Promise.resolve(launch).then((launched) => {
        if (!launched) {throw new Error("VS Code rejected the editor-browser debug launch");}
        return started;
      })]);
      if (timer) {clearTimeout(timer); timer = undefined;}
      signal.throwIfAborted();
      const proxy = await session.customRequest("requestCDPProxy") as { host: string; port: number; path: string };
      const connection = await connectCdpProxy(proxy, signal);
      try {return { bytes: await captureCdpViewport(connection, request, signal), target: request.url! };}
      finally {connection.close();}
    } finally {
      if (timer) {clearTimeout(timer);}
      if (abort) {signal.removeEventListener("abort", abort);}
      subscription?.dispose();
      if (owned) {await vscode.debug.stopDebugging(owned);}
    }
  }
}

import { launchOwnedSession } from "@/infrastructure/capture/OwnedSessionLaunch";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend, CaptureFrame } from "@/infrastructure/capture/CaptureService";
import { connectCdpProxy, captureCdpViewport } from "@/infrastructure/capture/CdpViewport";
import { SystemBrowserCapture } from "@/infrastructure/capture/SystemBrowserCapture";
import type { SettingsRepository } from "@/application/ports";
import { abortable, waitForOwnedCdpProxy } from "@/infrastructure/capture/OwnedCdpProxy";

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
    const sessions: vscode.DebugSession[] = [];
    const observed = vscode.debug.onDidStartDebugSession((session) => sessions.push(session));
    const stop = (session: vscode.DebugSession) => abortable(vscode.debug.stopDebugging(session), AbortSignal.timeout(2000));
    let concrete: vscode.DebugSession | undefined;
    try {
      const owned = await launchOwnedSession<vscode.DebugSession>({
        signal,
        timeoutMs: 20_000,
        subscribe: (onSession) => vscode.debug.onDidStartDebugSession((session) => {
          if (session.name === name && ["editor-browser", "pwa-editor-browser"].includes(session.type)) {onSession(session);}
        }),
        launch: () => vscode.debug.startDebugging(undefined, { type: "editor-browser", request: "launch", name, url: request.url, noDebug: false }),
        stop,
      });
      try {
        signal.throwIfAborted();
        const ready = await waitForOwnedCdpProxy(owned.session, () => sessions, (session) => session.id === owned.session.id ? Promise.resolve(undefined) : session.customRequest("requestCDPProxy"), signal);
        concrete = ready.session;
        const connection = await connectCdpProxy(ready.address, signal);
        try {return { bytes: await captureCdpViewport(connection, request, signal), target: request.url! };}
        finally {
          try {await abortable(connection.request("Page.close"), AbortSignal.timeout(2000));}
          catch { /* The target may already be closed or cancelled. */ }
          finally {connection.close();}
        }
      } finally {
        try {if (concrete && concrete.id !== owned.session.id) {await stop(concrete);}}
        finally {await owned.dispose();}
      }
    } finally {observed.dispose();}
  }
}

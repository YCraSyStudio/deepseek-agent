import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend } from "./CaptureService";
import type { WaylandPortalOptions } from "./WaylandPortalCapture";

export type CapturePermission = "ask" | "first-use" | "always";
interface PermissionState { views?: string[]; tokens?: Record<string, string> }
interface Options {
  mode(): CapturePermission;
  read(): PermissionState | undefined;
  save(state: PermissionState): PromiseLike<void>;
  confirm(view: string): PromiseLike<boolean>;
  systemChooser(request: CaptureScreenshotRequest): boolean;
  debugPid?(): number | undefined;
  application?(pid: number): Promise<string | undefined>;
}

/** One permission policy for explicit/automatic web, app and display captures. */
export class CapturePermissions {
  private queue: Promise<void> = Promise.resolve();
  private readonly session = randomUUID();
  private readonly views: Set<string>;
  private readonly tokens: Record<string, string>;
  constructor(private readonly options: Options) {
    const saved = options.read();
    this.views = new Set((saved?.views ?? []).filter(value => /^[a-f0-9]{64}$/.test(value)).slice(-256));
    this.tokens = Object.fromEntries(Object.entries(saved?.tokens ?? {}).filter(([key, value]) => /^[a-f0-9]{64}$/.test(key) && typeof value === "string" && value.length <= 4096).slice(-256));
  }
  wrap(backend: CaptureBackend): CaptureBackend {
    return { timeoutMs: Math.max(backend.timeoutMs ?? 30_000, 120_000), capture: (request, signal) => {
      const operation = this.queue.then(async () => {
        signal.throwIfAborted();
        const view = await this.view(request);
        const key = this.key(view);
        const mode = this.options.mode();
        // The Wayland chooser itself authorizes capture. Do not stack another dialog on it.
        if (!this.options.systemChooser(request) && (mode === "ask" || (mode === "first-use" && !this.views.has(key)))) {
          if (!await this.options.confirm(view)) {throw new Error("Screenshot capture was not authorized");}
          signal.throwIfAborted();
          if (mode === "first-use") {this.views.add(key); await this.persist();}
        }
        return backend.capture(request, signal);
      });
      this.queue = operation.then(() => {}, () => {});
      return operation;
    } };
  }
  async portalOptions(request: CaptureScreenshotRequest): Promise<WaylandPortalOptions> {
    if (this.options.mode() === "ask") {return { persistent: false };}
    const key = this.key(await this.view(request));
    return { persistent: true, restoreToken: this.tokens[key], onRestoreToken: async token => {
      this.tokens[key] = token;
      await this.persist();
    } };
  }
  private async view(request: CaptureScreenshotRequest): Promise<string> {
    if (request.target === "web") {return `web:${new URL(request.url!).href}`;}
    if (request.target === "screen") {return "display:screen";}
    const pid = request.process === undefined && request.target === "debug" ? this.options.debugPid?.() : Number(request.process);
    if (pid && Number.isSafeInteger(pid) && pid > 0) {
      const executable = this.options.application ? await this.options.application(pid) : process.platform === "linux"
        ? await realpath(`/proc/${pid}/exe`).catch(() => undefined) : undefined;
      if (executable) {return `app:${executable}`;}
      // PID reuse must not transfer remembered permissions to another application after reload.
      return `app-session:${this.session}:${pid}`;
    }
    if (!request.window?.trim()) {throw new Error("An app title or PID is required for screenshot capture");}
    return `app-title:${request.window.trim()}`;
  }
  private key(view: string): string {return createHash("sha256").update(view).digest("hex");}
  private async persist(): Promise<void> {
    const views = [...this.views].slice(-256);
    const tokens = Object.fromEntries(Object.entries(this.tokens).slice(-256));
    await this.options.save({ views, tokens });
  }
}

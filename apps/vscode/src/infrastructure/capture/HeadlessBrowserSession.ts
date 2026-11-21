import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { redactSensitiveText } from "@/shared/security/Redaction";
import type { CdpConnection } from "./CdpViewport";

const MAX_PACKET_BYTES = 24 * 1024 * 1024;

/** CDP uses the owned child's pipes, never a visible tab or an open debugging port. */
export class HeadlessBrowserSession {
  private readonly pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly input: Writable;
  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  private nextId = 0;
  private failure?: Error;
  private disposal?: Promise<void>;
  private readonly exited: Promise<void>;
  private readonly abort = () => {this.fail(this.signal.reason instanceof Error ? this.signal.reason : new Error("Headless capture cancelled")); void this.dispose();};

  constructor(private readonly child: ChildProcess, private readonly signal: AbortSignal) {
    this.input = child.stdio[3] as Writable;
    const output = child.stdio[4] as Readable;
    let diagnostics = "";
    this.exited = new Promise((resolve) => {
      child.once("error", (error) => {this.fail(error); resolve();});
      child.once("exit", (code) => {this.fail(new Error(`Headless browser exited (${code ?? "signal"})${diagnostics ? `: ${redactSensitiveText(diagnostics).slice(-500)}` : ""}`)); resolve();});
    });
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    output.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let end: number;
      while ((end = buffer.indexOf("\0")) !== -1) {
        const packet = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(packet) > MAX_PACKET_BYTES) {this.fail(new Error("Headless CDP response exceeds its size limit")); void this.dispose(); return;}
        try {
          const message = JSON.parse(packet);
          if (typeof message.method === "string") {
            for (const listener of this.listeners.get(`${message.sessionId}:${message.method}`) ?? []) {listener(message.params ?? {});}
            continue;
          }
          const entry = this.pending.get(message.id);
          if (!entry) {continue;}
          clearTimeout(entry.timer); this.pending.delete(message.id);
          if (message.error) {entry.reject(new Error(`Headless CDP request failed: ${String(message.error.message).slice(0, 300)}`));}
          else {entry.resolve(message.result ?? {});}
        } catch {this.fail(new Error("Invalid headless CDP response")); void this.dispose(); return;}
      }
      if (Buffer.byteLength(buffer) > MAX_PACKET_BYTES) {this.fail(new Error("Headless CDP response exceeds its size limit")); void this.dispose();}
    });
    output.on("error", (error) => this.fail(error));
    output.on("end", () => this.fail(new Error(`Headless browser pipe closed${diagnostics ? `: ${redactSensitiveText(diagnostics).slice(-500)}` : ""}`)));
    this.input.on("error", (error) => this.fail(error));
    // Drain diagnostics so a noisy page/browser cannot block capture on stderr.
    child.stderr?.on("data", (chunk: Buffer) => {diagnostics = (diagnostics + chunk.toString("utf8")).slice(-8192);});
    child.stderr?.on("error", () => undefined);
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) {this.abort();}
  }

  private request(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    this.signal.throwIfAborted();
    if (this.failure) {return Promise.reject(this.failure);}
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`Headless CDP ${method} timed out`));}, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`, (error) => {
        if (error) {this.fail(error);}
      });
    });
  }

  async page(): Promise<CdpConnection> {
    const version = await this.request("Browser.getVersion");
    if (typeof version.product !== "string" || !/(?:Chrome|Chromium|Edge|Edg)\//.test(version.product)) {throw new Error("Headless browser does not identify as a supported Chromium build");}
    const target = await this.request("Target.createTarget", { url: "about:blank" });
    if (typeof target.targetId !== "string") {throw new Error("Headless browser did not create a page");}
    const attached = await this.request("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    if (typeof attached.sessionId !== "string") {throw new Error("Headless browser did not attach to its page");}
    const sessionId = attached.sessionId;
    return { request: (method, params) => this.request(method, params, sessionId), on: (method, listener) => {
      const key = `${sessionId}:${method}`;
      let listeners = this.listeners.get(key);
      if (!listeners) {this.listeners.set(key, listeners = new Set());}
      listeners.add(listener);
      return () => {listeners.delete(listener);};
    }, close: () => {void this.dispose();} };
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const entry of this.pending.values()) {clearTimeout(entry.timer); entry.reject(this.failure);}
    this.pending.clear();
  }

  dispose(): Promise<void> {
    return this.disposal ??= this.stop();
  }

  private async stop(): Promise<void> {
    this.signal.removeEventListener("abort", this.abort);
    this.fail(new Error("Headless browser session closed"));
    this.listeners.clear();
    if (this.child.pid) {
      if (process.platform === "win32" && this.child.exitCode === null && this.child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const cleanup = spawn("taskkill", ["/PID", String(this.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          const timer = setTimeout(() => {cleanup.kill(); this.child.kill(); resolve();}, 2000);
          const done = () => {clearTimeout(timer); this.child.kill(); resolve();};
          cleanup.once("error", done); cleanup.once("exit", done);
        });
      } else if (process.platform !== "win32") {
        try {process.kill(-this.child.pid, "SIGKILL");} catch {this.child.kill("SIGKILL");}
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {await Promise.race([this.exited, new Promise<void>((resolve) => {timer = setTimeout(resolve, 2000);})]);}
    finally {
      clearTimeout(timer);
      this.input.destroy(); (this.child.stdio[4] as Readable).destroy(); this.child.stderr?.destroy();
    }
  }
}

export function launchHeadlessBrowser(binary: string, profile: string, signal: AbortSignal, extraArgs: readonly string[] = []): HeadlessBrowserSession {
  signal.throwIfAborted();
  return new HeadlessBrowserSession(spawn(binary, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-extensions", "--disable-sync", "--remote-debugging-pipe",
    `--user-data-dir=${profile}`, ...extraArgs, "about:blank"], {
    shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  }), signal);
}

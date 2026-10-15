import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ToolHostCommandOptions, ToolHostCommandResult } from "@/application/ports";
import { boundUtf8HeadTail, takeUtf8Head, takeUtf8Tail } from "@/shared/utils/BoundedText";

const OUTPUT_DRAIN_GRACE_MS = 500;
const TERMINATION_GRACE_MS = 1_500;
const activeChildren = new Set<ChildProcess>();
const managedExecutions = new Set<() => Promise<void>>();

export function registerManagedExecution(stop: () => Promise<void>): () => void {
  managedExecutions.add(stop);
  return () => { managedExecutions.delete(stop); };
}

export interface CommandLaunch {
  executable: string;
  args: string[];
  options: SpawnOptions;
  readinessFd?: number;
}

export async function executeOwnedCommand(
  launch: CommandLaunch,
  options: ToolHostCommandOptions,
  onOutput?: (chunk: string) => void,
): Promise<ToolHostCommandResult & { runnerStarted?: boolean }> {
  if (options.signal?.aborted) {throw createAbortError();}
  const { timeoutMs, maxOutputBytes } = options;
  const startedAt = performance.now();

  return new Promise<ToolHostCommandResult & { runnerStarted?: boolean }>((resolve, reject) => {
    const child = spawn(launch.executable, launch.args, {
      ...launch.options,
      cwd: options.cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: launch.options.stdio ?? ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child);
    let readiness = "";
    if (launch.readinessFd !== undefined) {
      (child.stdio[launch.readinessFd] as Readable | null)?.on("data", (chunk: Buffer) => {
        readiness = (readiness + chunk.toString("utf8")).slice(0, 16);
      });
    }
    const stdout = new BoundedOutput(maxOutputBytes);
    const stderr = new BoundedOutput(maxOutputBytes);
    let settled = false;
    let timedOut = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationConfirmed: boolean | undefined;
    let terminationStarted = false;

    child.stdout?.on("data", (chunk: Buffer) => { stdout.append(chunk); onOutput?.(chunk.toString("utf8")); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr.append(chunk); onOutput?.(chunk.toString("utf8")); });

    const cleanup = () => {
      clearTimeout(timeout);
      if (drainTimer) {clearTimeout(drainTimer);}
      options.signal?.removeEventListener("abort", onAbort);
      activeChildren.delete(child);
    };
    const finish = (callback: () => void) => {
      if (settled) {return;}
      settled = true;
      cleanup();
      callback();
    };
    const resolveResult = () => finish(() => resolve({
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode,
      signal: exitSignal,
      timedOut,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
      terminationConfirmed,
      ...(launch.readinessFd === undefined ? {} : { runnerStarted: readiness === "ready" }),
    }));
    const terminateAndBoundSettlement = (after: () => void) => {
      if (terminationStarted || settled) {return;}
      terminationStarted = true;
      void terminateProcessTree(child).then((confirmed) => {
        terminationConfirmed = confirmed;
        child.stdout?.destroy();
        child.stderr?.destroy();
        after();
      });
    };
    const onAbort = () => {
      terminateAndBoundSettlement(() => finish(() => reject(createAbortError(terminationConfirmed))));
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateAndBoundSettlement(resolveResult);
    }, timeoutMs);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (terminationStarted) {return;}
      drainTimer = setTimeout(() => {
        terminateAndBoundSettlement(resolveResult);
      }, OUTPUT_DRAIN_GRACE_MS);
    });
    child.once("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (terminationStarted) {return;}
      resolveResult();
    });
    if (options.signal?.aborted) {onAbort();}
  });
}

export class BoundedOutput {
  private readonly decoder = new StringDecoder("utf8");
  private pendingLine = "";
  private diagnostics = "";
  private readonly head: Buffer[] = [];
  private readonly tail: Buffer[] = [];
  private headBytes = 0;
  private tailBytes = 0;
  private readonly half: number;
  truncated = false;

  constructor(private readonly limit: number) {
    this.half = Math.floor(limit / 2);
  }

  append(chunk: Buffer): void {
    this.collectDiagnostics(this.decoder.write(chunk));
    if (this.headBytes < this.half) {
      const take = Math.min(chunk.byteLength, this.half - this.headBytes);
      this.head.push(Buffer.from(chunk.subarray(0, take)));
      this.headBytes += take;
      chunk = chunk.subarray(take);
    }
    if (chunk.byteLength === 0) {return;}
    this.truncated = this.truncated || this.headBytes + this.tailBytes + chunk.byteLength > this.limit;
    this.tail.push(chunk);
    this.tailBytes += chunk.byteLength;
    while (this.tailBytes > this.limit - this.half && this.tail.length > 0) {
      const overflow = this.tailBytes - (this.limit - this.half);
      const first = this.tail[0];
      if (first.byteLength <= overflow) {
        this.tail.shift();
        this.tailBytes -= first.byteLength;
      } else {
        this.tail[0] = Buffer.from(first.subarray(overflow));
        this.tailBytes -= overflow;
      }
    }
  }

  toString(): string {
    if (!this.truncated) {return Buffer.concat([...this.head, ...this.tail]).toString("utf8");}
    const diagnostics = this.isDiagnostic(this.pendingLine)
      ? this.boundDiagnostics(this.diagnostics + this.pendingLine)
      : this.diagnostics;
    const marker = "\n...[output truncated; middle omitted]...\n";
    const evidence = diagnostics ? `\n...[retained diagnostic excerpts; bounded]...\n${diagnostics}\n` : "";
    const reserved = Buffer.byteLength(marker + evidence, "utf8");
    if (reserved >= this.limit) {return takeUtf8Head(marker + evidence, this.limit);}
    const remaining = this.limit - reserved;
    return takeUtf8Head(Buffer.concat(this.head).toString("utf8"), Math.floor(remaining / 2)) +
      marker + evidence + takeUtf8Tail(Buffer.concat(this.tail).toString("utf8"), Math.ceil(remaining / 2));
  }

  private collectDiagnostics(text: string): void {
    // Scan bounded windows so a single newline-free log cannot grow the retained state.
    for (let offset = 0; offset < text.length;) {
      const end = Math.min(text.length, offset + 4096);
      this.pendingLine += text.slice(offset, end);
      offset = end;
      let newline: number;
      while ((newline = this.pendingLine.search(/[\r\n]/)) >= 0) {
        const line = this.pendingLine.slice(0, newline);
        this.pendingLine = this.pendingLine.slice(newline + 1);
        if (this.isDiagnostic(line)) {this.diagnostics = this.boundDiagnostics(this.diagnostics + line + "\n");}
      }
      if (this.pendingLine.length > 8192) {
        if (this.isDiagnostic(this.pendingLine)) {
          this.diagnostics = this.boundDiagnostics(this.diagnostics + this.pendingLine + "\n");
        }
        this.pendingLine = this.pendingLine.slice(-256);
      }
    }
  }

  private isDiagnostic(line: string): boolean {
    const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
    return /\b(error|failed|failure|exception|fatal|traceback)\b|\b(?:TS|CS)\d{4}\b|^\s*(?:at\s+\S+|[×✖])/i.test(plain);
  }

  private boundDiagnostics(value: string): string {
    return boundUtf8HeadTail(value, Math.min(16 * 1024, Math.floor(this.limit / 3))).text;
  }
}

export async function shutdownOwnedProcesses(): Promise<void> {
  await Promise.allSettled([...activeChildren].map((child) => terminateProcessTree(child)).concat([...managedExecutions].map((stop) => stop().then(() => true))));
}

async function terminateProcessTree(child: ChildProcess): Promise<boolean> {
  if (!child.pid || hasExited(child)) {return true;}
  if (process.platform === "win32") {
    return runBoundedTaskkill(child);
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  if (await waitForExit(child, TERMINATION_GRACE_MS / 2)) {return true;}
  try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  return waitForExit(child, TERMINATION_GRACE_MS / 2);
}

function runBoundedTaskkill(child: ChildProcess): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timer);
      resolve(confirmed);
    };
    const timer = setTimeout(() => {
      cleanup.kill();
      finish(false);
    }, TERMINATION_GRACE_MS);
    cleanup.once("error", () => finish(false));
    cleanup.once("close", (code) => finish(code === 0 || hasExited(child)));
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) {return Promise.resolve(true);}
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function createAbortError(terminationConfirmed?: boolean): Error {
  const error = new Error("Command execution cancelled");
  error.name = "AbortError";
  Object.assign(error, { terminationConfirmed });
  return error;
}

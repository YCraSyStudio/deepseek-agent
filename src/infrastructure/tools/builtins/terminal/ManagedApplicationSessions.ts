import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ApplicationSessionRequest, ApplicationSessionResult } from "@/contracts/ApplicationSession";
import { BoundedOutput, resolveCommandEnvironment, type CommandEnvironment } from "./ShellExecution";
import { logWarning } from "@/shared/logging/Logger";

const managers = new Set<ManagedApplicationSessions>();
const OUTPUT_LIMIT = 64 * 1024;
const MAX_SESSIONS = 8;
const MAX_RUNNING = 3;
const MAX_LIFETIME_MS = 10 * 60_000;

interface Application {
  id: string;
  command: string;
  environment: CommandEnvironment;
  child: ChildProcess;
  stdout: BoundedOutput;
  stderr: BoundedOutput;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  closed: boolean;
  stopping: boolean;
  timedOut: boolean;
  failure?: Error;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: Promise<boolean>;
  terminationConfirmed?: boolean;
}

/** A turn owns these foreground process groups; tool calls never wait for their lifetime. */
export class ManagedApplicationSessions {
  private readonly applications = new Map<string, Application>();
  private closing = false;
  private disposal?: Promise<void>;
  private readonly abort = () => {void this.dispose();};

  constructor(private readonly signal: AbortSignal, readonly conversationId: string, private readonly lifetimeMs = MAX_LIFETIME_MS) {
    signal.throwIfAborted();
    managers.add(this);
    signal.addEventListener("abort", this.abort, { once: true });
  }

  async execute(request: ApplicationSessionRequest): Promise<ApplicationSessionResult> {
    this.signal.throwIfAborted();
    if (this.closing) {throw new Error("Application sessions are closed for this turn");}
    if (request.action === "start") {return this.start(request);}
    const application = this.applications.get(request.session_id);
    if (!application) {throw new Error("Unknown application session in this turn; sessions cannot control another chat or arbitrary PID");}
    if (request.action === "stop") {
      application.stopping = true;
      await this.terminate(application);
    } else {await this.wait(application, request.wait_ms ?? 0);}
    this.signal.throwIfAborted();
    if (application.exited) {await this.terminate(application);}
    return this.result(application);
  }

  dispose(): Promise<void> {
    if (this.disposal) {return this.disposal;}
    this.closing = true;
    this.signal.removeEventListener("abort", this.abort);
    this.disposal = Promise.all([...this.applications.values()].map(async (application) => {
      application.stopping = true;
      await this.terminate(application);
    })).then(() => {managers.delete(this);});
    return this.disposal;
  }

  private async start(request: Extract<ApplicationSessionRequest, { action: "start" }>): Promise<ApplicationSessionResult> {
    const environment = await resolveApplicationEnvironment(request.cwd);
    this.signal.throwIfAborted();
    if (this.closing) {throw new Error("Application sessions are closed for this turn");}
    if (this.applications.size >= MAX_SESSIONS || [...this.applications.values()].filter((app) => !app.cleanup && !app.exited).length >= MAX_RUNNING) {
      throw new Error("Application session limit reached (3 running, 8 launches per turn). Stop unused sessions and avoid repeated launches.");
    }
    const child = spawn(request.command, {
      cwd: environment.cwd, shell: environment.shell, windowsHide: true,
      // Preview hosts may treat stdin EOF as owner shutdown. Keep the pipe open
      // for the session, without exposing interactive stdin to the model.
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MSBUILDDISABLENODEREUSE: "1", DOTNET_CLI_USE_MSBUILD_SERVER: "0", GIT_PAGER: "cat", PAGER: "cat" },
    });
    const application: Application = {
      id: randomUUID(), command: request.command, environment, child,
      stdout: new BoundedOutput(OUTPUT_LIMIT), stderr: new BoundedOutput(OUTPUT_LIMIT),
      exitCode: null, signal: null, exited: false, closed: false, stopping: false, timedOut: false,
    };
    this.applications.set(application.id, application);
    child.stdout?.on("data", (chunk: Buffer) => application.stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => application.stderr.append(chunk));
    child.stdin?.on("error", () => undefined);
    child.once("close", () => {application.closed = true;});
    child.once("error", (error) => {application.failure = error; application.exited = true; void this.terminate(application);});
    child.once("exit", (code, signal) => {
      application.exitCode = code; application.signal = signal; application.exited = true;
      // A wrapper exiting must not leave its children running behind it.
      void this.terminate(application);
    });
    application.timer = setTimeout(() => {
      application.timedOut = true; application.stopping = true;
      void this.terminate(application);
    }, this.lifetimeMs);
    try {
      await this.wait(application, request.wait_ms ?? 1000);
      this.signal.throwIfAborted();
      if (application.exited) {await this.terminate(application);}
      if (application.failure) {throw application.failure;}
      return this.result(application);
    } catch (error) {await this.terminate(application); throw error;}
  }

  private terminate(application: Application): Promise<boolean> {
    if (application.cleanup) {return application.cleanup;}
    clearTimeout(application.timer);
    application.child.stdin?.end();
    application.cleanup = terminateOwnedGroup(application.child).then(async (confirmed) => {
      application.terminationConfirmed = confirmed;
      await drainOutput(application);
      application.child.stdout?.destroy(); application.child.stderr?.destroy();
      if (!confirmed) {logWarning("Could not confirm managed application process-tree termination", { sessionId: application.id }, { conversationId: this.conversationId });}
      return confirmed;
    });
    return application.cleanup;
  }

  private wait(application: Application, milliseconds: number): Promise<void> {
    if (application.exited || milliseconds === 0) {return Promise.resolve();}
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer); this.signal.removeEventListener("abort", done);
        application.child.removeListener("exit", done); application.child.removeListener("error", done);
        resolve();
      };
      const timer = setTimeout(done, milliseconds);
      application.child.once("exit", done); application.child.once("error", done);
      this.signal.addEventListener("abort", done, { once: true });
      if (this.signal.aborted) {done();}
    });
  }

  private result(application: Application): ApplicationSessionResult {
    const running = !application.exited && !application.cleanup;
    return {
      kind: "application_session", sessionId: application.id,
      status: running ? "running" : application.stopping ? "stopped" : "exited",
      command: application.command, cwd: application.environment.cwd, pid: application.child.pid,
      stdout: application.stdout.toString(), stderr: application.stderr.toString(),
      exitCode: application.exitCode, signal: application.signal, timedOut: application.timedOut,
      terminationConfirmed: application.terminationConfirmed,
      truncated: { stdout: application.stdout.truncated, stderr: application.stderr.truncated },
      note: running
        ? "The process is running; window/readiness is not verified. Continue with capture_screenshot while it stays open. Inspect startup output or use status if needed. Stop this session after capture; it is also stopped at turn end, cancellation or after 10 minutes."
        : application.terminationConfirmed === false
          ? "Process-tree termination could not be confirmed; do not assume all child processes stopped."
          : "The application process ended. Inspect exitCode and output before claiming startup succeeded.",
    };
  }
}

async function drainOutput(application: Application): Promise<void> {
  if (application.closed) {return;}
  await new Promise<void>((resolve) => {
    const done = () => {clearTimeout(timer); application.child.removeListener("close", done); resolve();};
    const timer = setTimeout(done, 250);
    application.child.once("close", done);
  });
}

export async function resolveApplicationEnvironment(cwd?: string): Promise<CommandEnvironment> {
  const environment = await resolveCommandEnvironment(cwd);
  // The VS Code host describes its integrated terminal here; this owned child
  // needs an executable shell, and does not allocate another terminal tab.
  return { ...environment, shell: process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.env.SHELL ?? "/bin/sh" };
}

export async function closeConversationApplications(conversationId: string): Promise<void> {
  await Promise.all([...managers].filter((manager) => manager.conversationId === conversationId).map((manager) => manager.dispose()));
}
export async function shutdownApplicationSessions(): Promise<void> {
  await Promise.all([...managers].map((manager) => manager.dispose()));
}

async function terminateOwnedGroup(child: ChildProcess): Promise<boolean> {
  if (!child.pid) {return true;}
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) {return true;}
    return new Promise((resolve) => {
      const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => {cleanup.kill(); resolve(false);}, 2000);
      cleanup.once("error", () => {clearTimeout(timer); resolve(false);});
      cleanup.once("close", (code) => {clearTimeout(timer); resolve(code === 0);});
    });
  }
  const exists = () => {
    try {process.kill(-child.pid!, 0); return true;}
    catch (error) {return (error as NodeJS.ErrnoException).code !== "ESRCH";}
  };
  if (!exists()) {return true;}
  try {process.kill(-child.pid, "SIGTERM");} catch {return !exists();}
  if (await waitForGroup(exists, 750)) {return true;}
  try {process.kill(-child.pid, "SIGKILL");} catch {return !exists();}
  return waitForGroup(exists, 750);
}
async function waitForGroup(exists: () => boolean, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (exists() && Date.now() < deadline) {await new Promise((resolve) => setTimeout(resolve, 25));}
  return !exists();
}

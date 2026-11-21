import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BoundedOutput, type CommandEnvironment } from "./ShellExecution";
import { logWarning } from "@/shared/logging/Logger";
import type { RunningTaskInfo } from "@/contracts/RunningTasks";

const OUTPUT_LIMIT = 64 * 1024;
const MAX_RUNNING_PER_CONVERSATION = 3;
const MAX_SESSIONS_PER_CONVERSATION = 8;
const MAX_LIFETIME_MS = 4 * 60 * 60_000;
const TERMINATION_GRACE_MS = 1_500;
const SCOPED_CONVERSATION = "conversation:unscoped";


export interface KeepAliveTerminalResult {
  kind: "keep_alive_terminal";
  sessionId: string;
  status: "running" | "exited" | "stopped";
  command?: string;
  cwd?: string;
  pid?: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: { stdout: boolean; stderr: boolean };
  lifetimeMs?: number;
  expiresAt?: string;
  terminationConfirmed?: boolean;
  note: string;
}

interface KeepAliveTerminal {
  id: string;
  conversationId: string;
  name: string;
  command: string;
  startedAt: number;
  environment: CommandEnvironment;
  child: ChildProcess;
  stdout: BoundedOutput;
  stderr: BoundedOutput;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  stopping: boolean;
  timedOut: boolean;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: Promise<boolean>;
  terminationConfirmed?: boolean;
}

const terminals = new Map<string, KeepAliveTerminal>();
const conversationTerminals = new Map<string, Set<string>>();
const changeListeners = new Set<(conversationId: string) => void>();

export function onKeepAliveTerminalsChanged(listener: (conversationId: string) => void): () => void {
  changeListeners.add(listener);
  return () => {changeListeners.delete(listener);};
}

export function listKeepAliveTasks(conversationId?: string): RunningTaskInfo[] {
  const owned = conversationTerminals.get(conversationId ?? SCOPED_CONVERSATION);
  if (!owned) {return [];}
  const tasks: RunningTaskInfo[] = [];
  for (const id of owned) {
    const terminal = terminals.get(id);
    if (!terminal || terminal.exited || terminal.stopping) {continue;}
    tasks.push({
      id: terminal.id,
      name: terminal.name,
      command: terminal.command,
      cwd: terminal.environment.cwd,
      pid: terminal.child.pid,
      startedAt: new Date(terminal.startedAt).toISOString(),
    });
  }
  return tasks;
}

export function startKeepAliveTerminal(options: {
  command: string;
  environment: CommandEnvironment;
  conversationId?: string;
}): KeepAliveTerminalResult {
  const conversationId = options.conversationId ?? SCOPED_CONVERSATION;
  const owned = conversationTerminals.get(conversationId) ?? new Set<string>();
  const previous = [...owned].map((id) => terminals.get(id)).filter((terminal): terminal is KeepAliveTerminal => terminal !== undefined);
  for (const terminal of previous) {
    if (terminal.exited) {terminals.delete(terminal.id); owned.delete(terminal.id);}
  }
  const sessions = previous.filter((terminal) => !terminal.exited);
  const running = sessions.filter((terminal) => !terminal.cleanup);
  if (running.length >= MAX_RUNNING_PER_CONVERSATION || sessions.length >= MAX_SESSIONS_PER_CONVERSATION) {
    throw new Error("Keep-alive terminal limit reached for this conversation (3 running, 8 total). Stop unused sessions with keepAliveAction=\"stop\".");
  }

  const child = spawn(options.command, {
    cwd: options.environment.cwd,
    shell: options.environment.shell,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MSBUILDDISABLENODEREUSE: "1", DOTNET_CLI_USE_MSBUILD_SERVER: "0", GIT_PAGER: "cat", PAGER: "cat" },
  });
  const terminal: KeepAliveTerminal = {
    id: randomUUID(),
    conversationId,
    name: summarizeCommand(options.command),
    command: options.command,
    startedAt: Date.now(),
    environment: options.environment,
    child,
    stdout: new BoundedOutput(OUTPUT_LIMIT),
    stderr: new BoundedOutput(OUTPUT_LIMIT),
    exitCode: null,
    signal: null,
    exited: false,
    stopping: false,
    timedOut: false,
  };
  terminals.set(terminal.id, terminal);
  owned.add(terminal.id);
  conversationTerminals.set(conversationId, owned);
  child.stdout?.on("data", (chunk: Buffer) => terminal.stdout.append(chunk));
  child.stderr?.on("data", (chunk: Buffer) => terminal.stderr.append(chunk));
  child.once("error", (error) => {
    terminal.exited = true;
    terminal.stderr.append(Buffer.from(`Error: ${error.message}\n`));
    notifyChanged(terminal.conversationId);
  });
  child.once("exit", (code, signal) => {
    terminal.exitCode = code;
    terminal.signal = signal;
    terminal.exited = true;
    notifyChanged(terminal.conversationId);
  });
  terminal.timer = setTimeout(() => {
    terminal.timedOut = true;
    terminal.stopping = true;
    void terminate(terminal).then(() => notifyChanged(terminal.conversationId));
  }, MAX_LIFETIME_MS);
  terminal.timer.unref?.();
  notifyChanged(conversationId);
  return toResult(terminal);
}

export function getKeepAliveTerminal(sessionId: string, conversationId?: string): KeepAliveTerminalResult {
  return toResult(requireTerminal(sessionId, conversationId));
}

export async function stopKeepAliveTerminal(sessionId: string, conversationId?: string): Promise<KeepAliveTerminalResult> {
  const terminal = requireTerminal(sessionId, conversationId);
  terminal.stopping = true;
  await terminate(terminal);
  drainOutput(terminal);
  if (terminal.terminationConfirmed !== false) {
    terminals.delete(terminal.id);
    conversationTerminals.get(terminal.conversationId)?.delete(terminal.id);
  }
  notifyChanged(terminal.conversationId);
  return toResult(terminal);
}

export async function closeConversationKeepAliveTerminals(conversationId: string): Promise<void> {
  const owned = conversationTerminals.get(conversationId);
  if (!owned) {return;}
  await Promise.all([...owned].map(async (id) => {
    const terminal = terminals.get(id);
    if (!terminal) {return;}
    terminal.stopping = true;
    await terminate(terminal);
    terminals.delete(id);
  }));
  conversationTerminals.delete(conversationId);
  notifyChanged(conversationId);
}

export async function shutdownKeepAliveTerminals(): Promise<void> {
  await Promise.all([...conversationTerminals.keys()].map((conversationId) => closeConversationKeepAliveTerminals(conversationId)));
}

function requireTerminal(sessionId: string, conversationId?: string): KeepAliveTerminal {
  const terminal = terminals.get(sessionId);
  if (!terminal || (conversationId !== undefined && terminal.conversationId !== conversationId)) {
    throw new Error("Unknown keep-alive terminal for this conversation; sessions cannot control another chat or an arbitrary PID.");
  }
  return terminal;
}

function terminate(terminal: KeepAliveTerminal): Promise<boolean> {
  if (terminal.cleanup) {return terminal.cleanup;}
  clearTimeout(terminal.timer);
  terminal.cleanup = terminateOwnedGroup(terminal.child).then((confirmed) => {
    terminal.terminationConfirmed = confirmed;
    if (!confirmed) {
      logWarning("Could not confirm keep-alive terminal process-tree termination", { sessionId: terminal.id }, { conversationId: terminal.conversationId });
    }
    return confirmed;
  });
  return terminal.cleanup;
}

function toResult(terminal: KeepAliveTerminal): KeepAliveTerminalResult {
  const running = !terminal.exited && !terminal.cleanup;
  const status: KeepAliveTerminalResult["status"] = terminal.stopping && !running
    ? "stopped"
    : running ? "running" : "exited";
  return {
    kind: "keep_alive_terminal",
    sessionId: terminal.id,
    status,
    command: terminal.command,
    cwd: terminal.environment.cwd,
    pid: terminal.child.pid,
    stdout: terminal.stdout.toString(),
    stderr: terminal.stderr.toString(),
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    truncated: { stdout: terminal.stdout.truncated, stderr: terminal.stderr.truncated },
    ...(running ? { lifetimeMs: MAX_LIFETIME_MS, expiresAt: new Date(Date.now() + MAX_LIFETIME_MS).toISOString() } : {}),
    terminationConfirmed: terminal.terminationConfirmed,
    note: running
      ? "The isolated keep-alive terminal is running and survives this turn so the user can use the tool it serves. It is stopped only by keepAliveAction=\"stop\" with this sessionId, chat deletion, extension shutdown, or after 4 hours. Output shown is the retained tail; it does not prove readiness."
      : terminal.timedOut
        ? "The keep-alive session reached its 4-hour limit and was stopped."
        : terminal.terminationConfirmed === false
          ? "Process-tree termination could not be confirmed; do not assume all child processes stopped."
          : "The keep-alive process ended. Inspect exitCode and output before claiming it is running.",
  };
}

function summarizeCommand(command: string): string {
  const segments = command.replace(/\s+/g, " ").trim().split(/&&|\|\||;|\n/);
  const segment = segments.map((part) => part.trim()).filter(Boolean).pop() ?? command.trim();
  return segment.length > 48 ? `${segment.slice(0, 47)}…` : segment;
}

function notifyChanged(conversationId: string): void {
  for (const listener of changeListeners) {
    try {listener(conversationId);}
    catch (error) {logWarning("Keep-alive terminal change listener failed", { conversationId, error: String(error) });}
  }
}

function drainOutput(terminal: KeepAliveTerminal): void {
  terminal.child.stdout?.destroy();
  terminal.child.stderr?.destroy();
}

async function terminateOwnedGroup(child: ChildProcess): Promise<boolean> {
  if (!child.pid) {return true;}
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) {return true;}
    return new Promise((resolve) => {
      const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      let settled = false;
      const finish = (confirmed: boolean) => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timer);
        resolve(confirmed);
      };
      const timer = setTimeout(() => {cleanup.kill(); finish(false);}, TERMINATION_GRACE_MS);
      cleanup.once("error", () => finish(false));
      cleanup.once("close", (code) => finish(code === 0));
    });
  }
  const exists = () => {
    try {process.kill(-child.pid!, 0); return true;}
    catch (error) {return (error as NodeJS.ErrnoException).code !== "ESRCH";}
  };
  if (!exists()) {return true;}
  try {process.kill(-child.pid, "SIGTERM");} catch {return !exists();}
  if (await waitForGroup(exists, TERMINATION_GRACE_MS / 2)) {return true;}
  try {process.kill(-child.pid, "SIGKILL");} catch {return !exists();}
  return waitForGroup(exists, TERMINATION_GRACE_MS / 2);
}

async function waitForGroup(exists: () => boolean, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (exists() && Date.now() < deadline) {await new Promise((resolve) => setTimeout(resolve, 25));}
  return !exists();
}

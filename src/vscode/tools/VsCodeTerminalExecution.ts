import * as path from "node:path";
import * as vscode from "vscode";
import type { ToolHostCommandOptions, ToolHostCommandResult } from "@/application/ports";
import { BoundedOutput } from "@/infrastructure/tools/builtins/terminal/ShellExecution";

const TERMINAL_NAME = "YCraSy DeepSeek Agent";
export const VSCODE_TERMINAL_SHELL_DESCRIPTION = "VS Code integrated terminal (default profile)";
const SHELL_INTEGRATION_TIMEOUT_MS = 10_000;
const OUTPUT_DRAIN_GRACE_MS = 500;

interface ManagedTerminal {
  terminal: vscode.Terminal;
  cwd: string;
  closed: boolean;
}

interface TerminalOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  terminationConfirmed?: boolean;
}

const terminals = new Map<string, ManagedTerminal>();
let executionQueue: Promise<void> = Promise.resolve();

export function executeInVsCodeTerminal(
  command: string,
  options: ToolHostCommandOptions,
): Promise<ToolHostCommandResult> {
  const operation = executionQueue.then(() => executeQueued(command, options));
  executionQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function shutdownVsCodeTerminals(): void {
  for (const managed of terminals.values()) {
    managed.terminal.dispose();
    managed.closed = true;
  }
  terminals.clear();
}

async function executeQueued(command: string, options: ToolHostCommandOptions): Promise<ToolHostCommandResult> {
  throwIfAborted(options.signal);
  let managed = getOrCreateTerminal(options.cwd);
  let keepOpen = false;
  try {
    let integration = await waitForShellIntegration(managed, options.signal);

    if (integration.cwd?.scheme === "file" && !samePath(integration.cwd.fsPath, options.cwd)) {
      disposeManagedTerminal(managed);
      managed = getOrCreateTerminal(options.cwd);
      integration = await waitForShellIntegration(managed, options.signal);
    }

    throwIfAborted(options.signal);
    managed.terminal.show(true);
    const startedAt = performance.now();
    const execution = integration.executeCommand(command);
    const output = new BoundedOutput(options.maxOutputBytes);
    const drain = drainExecutionOutput(execution, output).catch(() => undefined);
    const outcome = await waitForExecutionEnd(managed, execution, options);
    await Promise.race([drain, delay(OUTPUT_DRAIN_GRACE_MS)]);
    keepOpen = !outcome.timedOut;

    return {
      stdout: output.toString(),
      stderr: "",
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      truncated: { stdout: output.truncated, stderr: false },
      terminationConfirmed: outcome.terminationConfirmed,
      shell: managed.terminal.state.shell ?? VSCODE_TERMINAL_SHELL_DESCRIPTION,
    };
  } finally {
    if (!managed.closed && !keepOpen) {disposeManagedTerminal(managed);}
  }
}

function getOrCreateTerminal(cwd: string): ManagedTerminal {
  const key = pathKey(cwd);
  const existing = terminals.get(key);
  if (existing && !existing.closed) {
    return existing;
  }

  const terminal = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    cwd: vscode.Uri.file(cwd),
    env: {
      DOTNET_CLI_USE_MSBUILD_SERVER: "0",
      MSBUILDDISABLENODEREUSE: "1",
      UseSharedCompilation: "false",
    },
  });
  const managed: ManagedTerminal = { terminal, cwd, closed: false };
  terminals.set(key, managed);
  const closeSubscription = vscode.window.onDidCloseTerminal((closedTerminal) => {
    if (closedTerminal !== terminal) {return;}
    managed.closed = true;
    if (terminals.get(key) === managed) {
      terminals.delete(key);
    }
    closeSubscription.dispose();
  });
  terminal.show(true);
  return managed;
}

function waitForShellIntegration(
  managed: ManagedTerminal,
  signal?: AbortSignal,
): Promise<vscode.TerminalShellIntegration> {
  if (managed.terminal.shellIntegration) {
    return Promise.resolve(managed.terminal.shellIntegration);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timeout);
      integrationSubscription.dispose();
      closeSubscription.dispose();
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    const integrationSubscription = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal === managed.terminal) {
        finish(() => resolve(event.shellIntegration));
      }
    });
    const closeSubscription = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === managed.terminal) {
        finish(() => reject(new Error("The YCraSy DeepSeek Agent terminal was closed before shell integration became available.")));
      }
    });
    const timeout = setTimeout(() => finish(() => reject(new Error(
      "VS Code shell integration is unavailable. Enable terminal shell integration and retry the command.",
    ))), SHELL_INTEGRATION_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {onAbort();}
  });
}

function waitForExecutionEnd(
  managed: ManagedTerminal,
  execution: vscode.TerminalShellExecution,
  options: ToolHostCommandOptions,
): Promise<TerminalOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timeout);
      endSubscription.dispose();
      closeSubscription.dispose();
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      finish(() => {
        disposeManagedTerminal(managed);
        reject(createAbortError(true));
      });
    };
    const endSubscription = vscode.window.onDidEndTerminalShellExecution((event) => {
      if (event.execution === execution) {
        finish(() => resolve({
          exitCode: event.exitCode ?? null,
          signal: event.exitCode === undefined ? "terminal_exit_unknown" : null,
          timedOut: false,
        }));
      }
    });
    const closeSubscription = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === managed.terminal) {
        finish(() => resolve({
          exitCode: null,
          signal: "terminal_closed",
          timedOut: false,
          terminationConfirmed: true,
        }));
      }
    });
    const timeout = setTimeout(() => {
      finish(() => {
        disposeManagedTerminal(managed);
        resolve({
          exitCode: null,
          signal: null,
          timedOut: true,
          terminationConfirmed: true,
        });
      });
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {onAbort();}
  });
}

async function drainExecutionOutput(
  execution: vscode.TerminalShellExecution,
  output: BoundedOutput,
): Promise<void> {
  for await (const chunk of execution.read()) {
    output.append(Buffer.from(stripTerminalControlSequences(chunk), "utf8"));
  }
}

function stripTerminalControlSequences(value: string): string {
  const escape = String.fromCharCode(27);
  const csi = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, "g");
  const osc = new RegExp(`${escape}\\][^${escape}\\u0007]*(?:\\u0007|${escape}\\\\)`, "g");
  return value.replace(osc, "").replace(csi, "").replace(/\r\n?/g, "\n");
}

function disposeManagedTerminal(managed: ManagedTerminal): void {
  managed.closed = true;
  terminals.delete(pathKey(managed.cwd));
  managed.terminal.dispose();
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function pathKey(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {throw createAbortError();}
}

function createAbortError(terminationConfirmed?: boolean): Error {
  const error = new Error("Command execution cancelled");
  error.name = "AbortError";
  Object.assign(error, { terminationConfirmed });
  return error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

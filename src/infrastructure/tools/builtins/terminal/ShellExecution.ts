import type { ToolHostCommandResult } from "@/application/ports";
import { executeSandboxedCommand } from "@/infrastructure/execution/LocalExecutionBroker";
export { BoundedOutput, shutdownOwnedProcesses } from "./ProcessExecution";
import { realpath } from "fs/promises";
import { getToolWorkspaceHost, resolveWorkspacePathSecure } from "@/infrastructure/tools/ToolWorkspace";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MIN_COMMAND_TIMEOUT_MS = 1_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const MIN_OUTPUT_BYTES = 4 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface WorkspaceCommandOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface WorkspaceCommandResult {
  kind: "command_result";
  command: string;
  cwd: string;
  shell: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: false;
  durationMs: number;
  truncated: { stdout: boolean; stderr: boolean };
  terminationConfirmed?: boolean;
  sandbox?: ToolHostCommandResult["sandbox"];
}

export interface CommandEnvironment {
  cwd: string;
  shell: string;
  workspaceRoot: string;
}

export async function resolveCommandEnvironment(cwd?: string): Promise<CommandEnvironment> {
  const workspace = getToolWorkspaceHost();
  const shell = workspace.getCommandShell?.()
    ?? (process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh"));
  if (workspace.resolveLocalPath) {
    const resolved = await workspace.resolveLocalPath(cwd);
    if (!resolved.workspaceRoot) {
      throw new Error("Terminal workspace root is unavailable");
    }
    return {
      cwd: resolved.absolutePath,
      shell,
      workspaceRoot: resolved.workspaceRoot,
    };
  }
  const rootPath = workspace.getRootPath();
  if (!rootPath) {
    throw new Error("No workspace folder open");
  }
  const workDir = cwd ? (await resolveWorkspacePathSecure(cwd, rootPath, realpath)).absolutePath : rootPath;
  return {
    cwd: workDir,
    shell,
    workspaceRoot: rootPath,
  };
}

export async function executeWorkspaceCommand(command: string, options: WorkspaceCommandOptions = {}): Promise<WorkspaceCommandResult> {
  const environment = await resolveCommandEnvironment(options.cwd);
  const timeoutMs = clampInteger(options.timeoutMs, MIN_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS, DEFAULT_COMMAND_TIMEOUT_MS);
  const maxOutputBytes = clampInteger(options.maxOutputBytes, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES);

  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const hostExecutor = getToolWorkspaceHost().executeCommand;
  if (hostExecutor) {
    const result = await hostExecutor(command, {
      cwd: environment.cwd,
      workspaceRoot: environment.workspaceRoot,
      signal: options.signal,
      timeoutMs,
      maxOutputBytes,
    });
    return {
      kind: "command_result",
      command,
      cwd: environment.cwd,
      shell: result.shell ?? environment.shell,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: false,
      durationMs: result.durationMs,
      truncated: result.truncated,
      terminationConfirmed: result.terminationConfirmed,
      sandbox: result.sandbox,
    };
  }

  const result = await executeSandboxedCommand(command, {
    cwd: environment.cwd, workspaceRoot: environment.workspaceRoot,
    signal: options.signal, timeoutMs, maxOutputBytes,
  }, getToolWorkspaceHost().getExecutionMode?.() === "full-access");
  return { ...result, kind: "command_result", command, cwd: environment.cwd,
    shell: result.shell ?? environment.shell, cancelled: false };
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value!)) : fallback;
}

function createAbortError(): Error {
  const error = new Error("Command execution cancelled");
  error.name = "AbortError";
  return error;
}

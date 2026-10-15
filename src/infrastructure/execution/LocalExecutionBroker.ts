import { physicalFileSystem } from "./PhysicalFileSystem";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { ToolHostCommandOptions, ToolHostCommandResult } from "@/application/ports";
import { executeOwnedCommand } from "@/infrastructure/tools/builtins/terminal/ProcessExecution";
import { createExecutionPolicy } from "./ExecutionPolicy";
import { createUnixLaunch } from "./UnixBackends";
import { executeWindowsCommand } from "./WindowsBackend";

export async function executeSandboxedCommand(
  command: string, options: ToolHostCommandOptions, fullAccess = false,
  onOutput?: (chunk: string) => void, readRoots: readonly string[] = [],
): Promise<ToolHostCommandResult> {
  if (options.signal?.aborted) {throw Object.assign(new Error("Command execution cancelled"), { name: "AbortError" });}
  if (fullAccess) {
    const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
    const result = await executeOwnedCommand({ executable: command, args: [], options: { shell } }, options, onOutput);
    return { ...result, shell, sandbox: { backend: "disabled:full-access", network: "unrestricted", warnings: [] } };
  }
  if (!["linux", "darwin", "win32"].includes(process.platform)) {
    throw new Error(`sandbox_unavailable: unsupported platform ${process.platform}`);
  }
  const { mkdir, mkdtemp, realpath, rm } = physicalFileSystem();
  const temporaryRoot = await realpath(await mkdtemp(path.join(tmpdir(), "ycrasy-execution-")));
  try {
    for (const name of ["home", "npm", "dotnet", "local", "roaming"]) {await mkdir(path.join(temporaryRoot, name));}
    const policy = await createExecutionPolicy(options.workspaceRoot, options.cwd, temporaryRoot, readRoots, options.signal);
    const securedOptions = { ...options, cwd: policy.cwd, workspaceRoot: policy.workspaceRoot };
    if (process.platform === "win32") {return await executeWindowsCommand(command, policy, securedOptions, onOutput);}
    const runner = await createUnixLaunch(command, policy);
    try {
      const result = await executeOwnedCommand(runner.launch, securedOptions, onOutput);
      if (!result.runnerStarted) {
        throw new Error(`sandbox_unavailable: platform runner failed to start: ${result.stderr.slice(-1500) || "no startup acknowledgement"}`);
      }
      const { runnerStarted: _started, ...output } = result;
      return { ...output, shell: "/bin/sh", sandbox: { backend: process.platform === "linux" ? "linux-bubblewrap-seccomp" : "macos-seatbelt", network: "deny", warnings: [] } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`sandbox_unavailable: ${process.platform === "linux" ? "install bubblewrap (bwrap)" : "sandbox-exec is unavailable"}. No command was executed without isolation.`, { cause: error });
      }
      throw error;
    } finally {await runner.close();}
  } finally {await rm(temporaryRoot, { recursive: true, force: true });}
}

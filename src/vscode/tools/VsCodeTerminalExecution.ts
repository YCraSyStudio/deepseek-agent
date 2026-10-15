import * as vscode from "vscode";
import type { ToolHostCommandOptions, ToolHostCommandResult } from "@/application/ports";
import { executeSandboxedCommand } from "@/infrastructure/execution/LocalExecutionBroker";

export const VSCODE_TERMINAL_SHELL_DESCRIPTION = process.platform === "win32" ? "cmd.exe (isolated command runner)" : "/bin/sh (isolated command runner)";
const terminals = new Map<vscode.Terminal, AbortController>();

export function shutdownVsCodeTerminals(): void {
  for (const [terminal, controller] of terminals) { controller.abort(); terminal.dispose(); }
  terminals.clear();
}

export async function executeInVsCodeTerminal(
  command: string, options: ToolHostCommandOptions, fullAccess = false,
): Promise<ToolHostCommandResult> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const writes = new vscode.EventEmitter<string>();
  let operation: Promise<ToolHostCommandResult> | undefined;
  let complete!: (result: ToolHostCommandResult) => void;
  let fail!: (reason: unknown) => void;
  const result = new Promise<ToolHostCommandResult>((resolve, reject) => { complete = resolve; fail = reject; });
  const terminal = vscode.window.createTerminal({
    name: `YCraSy Agent (${fullAccess ? "full-access" : "sandbox"})`,
    pty: {
      onDidWrite: writes.event,
      open: () => {
        writes.fire(`[${fullAccess ? "full-access: isolation disabled" : `sandbox: ${process.platform}; network denied`}]\r\n`);
        const setting = vscode.workspace.getConfiguration("deepseek-agent").inspect<string[]>("sandbox.readOnlyToolchainRoots");
        // Ignore workspace/folder values even if a hand-edited settings file contains a machine setting.
        const readRoots = setting?.globalValue ?? setting?.defaultValue ?? [];
        operation = executeSandboxedCommand(command, { ...options, signal }, fullAccess,
          (chunk) => writes.fire(chunk.replace(/\r?\n/g, "\r\n")), readRoots);
        operation.then((value) => {
          writes.fire(`\r\n[${value.sandbox?.backend}; exit ${value.exitCode ?? "unknown"}${value.timedOut ? "; timeout" : ""}]\r\n`);
          for (const warning of value.sandbox?.warnings ?? []) {writes.fire(`[sandbox warning] ${warning}\r\n`);}
          complete(value);
        }, (error: unknown) => {
          writes.fire(`\r\n${error instanceof Error ? error.message : "Sandbox execution failed"}\r\n`);
          fail(error);
        });
      },
      close: () => {
        controller.abort();
        terminals.delete(terminal);
        writes.dispose();
        if (!operation) {fail(Object.assign(new Error("Command terminal closed before execution"), { name: "AbortError" }));}
      },
      // Noninteractive command execution: no input is forwarded to another shell.
    },
  });
  terminals.set(terminal, controller);
  terminal.show(true);
  // Settling a command does not close its output view. VS Code calls pty.close
  // when the user closes the terminal, which releases its remaining resources.
  return result;
}

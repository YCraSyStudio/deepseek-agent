import type { ContainerRequest } from "@microsoft/mxc-sdk/v1";
import type { ToolHostCommandOptions, ToolHostCommandResult } from "@/application/ports";
import { BoundedOutput, registerManagedExecution } from "@/infrastructure/tools/builtins/terminal/ProcessExecution";
import type { ExecutionPolicy } from "./ExecutionPolicy";

export function createWindowsRequest(command: string, policy: ExecutionPolicy, timeoutMs: number): ContainerRequest {
  return {
    containment: { type: "processcontainer", config: { capabilities: [] } },
    command: `${policy.environment.ComSpec} /d /s /c "${command}"`,
    workingDirectory: policy.cwd,
    environment: policy.environment,
    inheritDefaultEnvironment: false,
    timeoutMs,
    filesystem: { readonlyPaths: policy.readRoots, readwritePaths: [policy.workspaceRoot, policy.temporaryRoot], deniedPaths: policy.protectedPaths, clearPolicyOnExit: true },
    network: { egress: { default: "deny" }, ingress: { default: "deny", hostLoopback: "deny" } },
    ui: { disable: true, clipboard: "none", allowInputInjection: false },
  };
}

type WindowsSandboxSdk = Pick<typeof import("@microsoft/mxc-sdk/v1"), "getAvailableBackends" | "probe" | "spawn">;

export async function executeWindowsCommand(
  command: string, policy: ExecutionPolicy, options: ToolHostCommandOptions, onOutput?: (chunk: string) => void,
  loadSdk: () => Promise<WindowsSandboxSdk> = () => import("@microsoft/mxc-sdk/v1"),
): Promise<ToolHostCommandResult> {
  // Keep SDK/native binaries external to the extension bundle; no native load on Unix.
  const sdk = await loadSdk();
  const backend = sdk.getAvailableBackends().find((entry) => entry.backend === "processcontainer");
  if (!backend || !["base-container", "appcontainer-bfs"].includes(backend.tier ?? "") || !backend.capabilities.includes("filesystemDeniedPaths")) {
    throw new Error("sandbox_unavailable: Windows requires MXC ProcessContainer with denied-path support (BaseContainer or AppContainer+BFS). DACL-only fallback is disabled. Update Windows 11.");
  }
  if (options.signal?.aborted) {throw abortError();}
  const request = createWindowsRequest(command, policy, options.timeoutMs);
  const probe = sdk.probe(request);
  if (probe.error || probe.needsDaclAugmentation || !["base-container", "appcontainer-bfs"].includes(probe.tier ?? "")) {
    throw new Error("sandbox_unavailable: MXC cannot enforce this policy without host ACL augmentation.");
  }
  const startedAt = performance.now();
  const processHandle = await sdk.spawn(request, { telemetry: { enabled: false } });
  const stdout = new BoundedOutput(options.maxOutputBytes);
  const stderr = new BoundedOutput(options.maxOutputBytes);
  const output = processHandle.standardOutput;
  const errors = processHandle.standardError;
  output?.on("data", (chunk: Buffer) => { stdout.append(chunk); onOutput?.(chunk.toString("utf8")); });
  errors?.on("data", (chunk: Buffer) => { stderr.append(chunk); onOutput?.(chunk.toString("utf8")); });
  const completion = processHandle.wait();
  const terminate = async () => { processHandle.kill(); await completion; };
  const unregister = registerManagedExecution(terminate);
  const onAbort = () => { processHandle.kill(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (options.signal?.aborted) {onAbort();}
    const outcome = await completion;
    if (options.signal?.aborted) {throw abortError(true);}
    return {
      stdout: stdout.toString(), stderr: stderr.toString(), exitCode: outcome.exitCode,
      signal: null, timedOut: outcome.timedOut, durationMs: Math.round(performance.now() - startedAt),
      truncated: { stdout: stdout.truncated, stderr: stderr.truncated }, terminationConfirmed: true,
      shell: "cmd.exe", sandbox: { backend: `windows-mxc:${probe.tier}`, network: "deny", warnings: [...backend.warnings, ...probe.warnings, ...processHandle.warnings] },
    };
  } finally {
    unregister(); options.signal?.removeEventListener("abort", onAbort); processHandle.dispose();
  }
}

function abortError(terminationConfirmed?: boolean): Error {
  return Object.assign(new Error("Command execution cancelled"), { name: "AbortError", terminationConfirmed });
}

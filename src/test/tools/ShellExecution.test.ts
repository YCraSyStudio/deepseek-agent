import * as assert from "assert";
import { existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { executeWorkspaceCommand, shutdownOwnedProcesses } from "@/infrastructure/tools/builtins/terminal/ShellExecution";
import { setToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";

suite("shell execution", () => {
  test("returns structured non-zero results and retains the tail of truncated output", async () => {
    setToolWorkspaceHost(createUnusedWorkspaceHost(process.cwd()));
    const script = "process.stdout.write('H'.repeat(6000)); process.stderr.write('TAIL'); process.exit(7)";
    const result = await executeWorkspaceCommand(`"${process.execPath}" -e "${script}"`, { maxOutputBytes: 4096 });
    assert.strictEqual(result.exitCode, 7);
    assert.strictEqual(result.timedOut, false);
    assert.ok(result.stdout.includes("output truncated"));
    assert.ok(result.stderr.endsWith("TAIL"));
    assert.ok(result.cwd);
    assert.ok(result.shell);
    assert.ok(Number.isInteger(result.durationMs));
    assert.ok(result.durationMs >= 0);
  });

  test("delegates command execution to the configured workspace host", async () => {
    let capturedCommand: string | undefined;
    let capturedCwd: string | undefined;
    setToolWorkspaceHost({
      ...createUnusedWorkspaceHost(process.cwd()),
      getCommandShell: () => "integrated-test-shell",
      executeCommand: async (command, options) => {
        capturedCommand = command;
        capturedCwd = options.cwd;
        return {
          stdout: "integrated output",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 12,
          truncated: { stdout: false, stderr: false },
          shell: "pwsh",
        };
      },
    });

    const result = await executeWorkspaceCommand("npm test");

    assert.strictEqual(capturedCommand, "npm test");
    assert.strictEqual(capturedCwd, process.cwd());
    assert.strictEqual(result.stdout, "integrated output");
    assert.strictEqual(result.shell, "pwsh");
    assert.strictEqual(result.exitCode, 0);
  });

  test("aborts a running command promptly", async () => {
    setToolWorkspaceHost(createUnusedWorkspaceHost(process.cwd()));
    const controller = new AbortController();
    const startedAt = Date.now();
    const execution = executeWorkspaceCommand(`"${process.execPath}" -e "setInterval(() => {}, 1000)"`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);

    await assert.rejects(execution, (error: unknown) =>
      error instanceof Error && error.name === "AbortError" && (error as Error & { terminationConfirmed?: boolean }).terminationConfirmed === true
    );
    assert.ok(Date.now() - startedAt < 5_000, "cancelled command should not wait for the normal timeout");
  });

  test("terminates registered commands during extension shutdown", async () => {
    setToolWorkspaceHost(createUnusedWorkspaceHost(process.cwd()));
    const startedAt = Date.now();
    const execution = executeWorkspaceCommand(`"${process.execPath}" -e "setInterval(() => {}, 1000)"`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await shutdownOwnedProcesses();
    await execution;
    assert.ok(Date.now() - startedAt < 5_000, "shutdown should settle an owned command instead of leaving it running");
  });

  test("terminates descendants when a command is cancelled", async () => {
    setToolWorkspaceHost(createUnusedWorkspaceHost(process.cwd()));
    const sandbox = await mkdtemp(path.join(tmpdir(), "deepseek-agent-process-test-"));
    const marker = path.join(sandbox, "child-survived.txt");
    const fixture = path.resolve("src/test/fixtures/SpawnChildProcess.mjs");
    const controller = new AbortController();

    try {
      const execution = executeWorkspaceCommand(`"${process.execPath}" "${fixture}" "${marker}"`, { signal: controller.signal });
      setTimeout(() => controller.abort(), 200);
      await assert.rejects(execution, (error: unknown) => error instanceof Error && error.name === "AbortError");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.strictEqual(existsSync(marker), false, "a descendant process survived cancellation");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("does not hang when an exited shell leaves inherited output handles open", async function () {
    this.timeout(10_000);
    setToolWorkspaceHost(createUnusedWorkspaceHost(process.cwd()));
    const sandbox = await mkdtemp(path.join(tmpdir(), "deepseek-agent-output-test-"));
    const marker = path.join(sandbox, "orphan-survived.txt");
    const fixture = path.resolve("src/test/fixtures/SpawnInheritedOutputChild.mjs");
    const startedAt = Date.now();

    try {
      const result = await executeWorkspaceCommand(`"${process.execPath}" "${fixture}" "${marker}"`, { timeoutMs: 5_000 });
      assert.ok(Date.now() - startedAt < 4_000, "inherited output handles should not keep the command running");
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      assert.strictEqual(existsSync(marker), false, "an inherited-output descendant survived command settlement");
      assert.strictEqual(result.timedOut, false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

function createUnusedWorkspaceHost(rootPath: string): ToolWorkspaceHost {
  const unused = async (): Promise<never> => {
    throw new Error("not used by this test");
  };
  return {
    getRootPath: () => rootPath,
    readFile: unused,
    writeFile: unused,
    stat: unused,
    createParentDirectory: unused,
    readDirectory: unused,
  };
}

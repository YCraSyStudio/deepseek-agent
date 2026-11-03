import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import { executeShellCommand } from "@/infrastructure/tools/builtins/terminal/ShellExecution";

const require = createRequire(import.meta.url);
const childProcesses = require("node:child_process") as typeof import("node:child_process");

suite("Windows command termination boundary", () => {
  const originalSpawn = childProcesses.spawn; let platform: PropertyDescriptor;
  class ProcessFixture extends EventEmitter {
    pid = 1073741824; exitCode: number | null = null; signalCode: string | null = null;
    stdout = new PassThrough(); stderr = new PassThrough(); kills = 0;
    kill() { this.kills++; return true; }
    exit() { this.exitCode = 0; this.emit("exit", 0, null); this.emit("close", 0, null); }
  }
  let owned: ProcessFixture; let helper: ProcessFixture; let calls: Array<{ command: string; args: unknown }>;
  let mode: "success" | "failed" | "error" | "timeout" | "already-exited";
  setup(() => {
    platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    mock.timers.enable({ apis: ["setTimeout"] }); owned = new ProcessFixture(); helper = new ProcessFixture(); calls = [];
    // Substitute only the process-launch boundary; no command reaches the host OS.
    childProcesses.spawn = ((command: string, args: unknown) => {
      calls.push({ command, args });
      if (command === "owned-fixture") { return owned; }
      assert.equal(command, "taskkill");
      queueMicrotask(() => {
        if (mode === "success" || mode === "already-exited") { owned.exit(); }
        if (mode === "error") { helper.emit("error", new Error("Taskkill unavailable")); helper.emit("close", 0); }
        else if (mode !== "timeout") { helper.emit("close", mode === "success" ? 0 : 1); }
      });
      return helper;
    }) as unknown as typeof childProcesses.spawn;
    syncBuiltinESMExports();
  });
  teardown(() => {
    mock.timers.reset(); owned.exit(); owned.stdout.destroy(); owned.stderr.destroy(); helper.stdout.destroy(); helper.stderr.destroy();
    childProcesses.spawn = originalSpawn; syncBuiltinESMExports(); Object.defineProperty(process, "platform", platform);
  });
  for (const result of ["success", "failed", "error", "timeout", "already-exited"] as const) {
    test(`bounds taskkill settlement and reports confirmation accurately: ${result}`, async () => {
      mode = result; const controller = new AbortController();
      const pending = executeShellCommand("owned-fixture", { cwd: "/fixture", workspaceRoot: "/fixture", shell: "fixture-shell" }, { signal: controller.signal });
      const rejected = assert.rejects(pending, error => error instanceof Error && error.name === "AbortError" &&
        (error as Error & { terminationConfirmed?: boolean }).terminationConfirmed === (result === "success" || result === "already-exited"));
      controller.abort(); if (result === "timeout") { mock.timers.tick(1500); }
      await rejected;
      assert.equal(calls.length, 2); assert.deepEqual(calls[1], { command: "taskkill", args: ["/pid", String(owned.pid), "/T", "/F"] });
      assert.equal(helper.kills, result === "timeout" ? 1 : 0);
      helper.emit("close", 0); assert.equal(owned.stdout.destroyed, true); assert.equal(owned.stderr.destroyed, true);
    });
  }
});

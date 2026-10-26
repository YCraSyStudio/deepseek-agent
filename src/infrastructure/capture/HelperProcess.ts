import { spawn } from "node:child_process";

export interface HelperOutput { stdout: string; stderr: string }
export function runCaptureHelper(executable: string, args: readonly string[], signal: AbortSignal, timeoutMs = 15000, maxOutputBytes = 128 * 1024): Promise<HelperOutput> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (error?: Error) => {
      if (settled) {return;}
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      child.stdout.destroy(); child.stderr.destroy();
      if (error) {reject(error);} else {resolve({ stdout, stderr });}
    };
    const kill = () => {
      if (!child.pid) {return;}
      if (process.platform === "win32") {
        const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        cleanup.on("error", () => child.kill());
      } else {try {process.kill(-child.pid, "SIGKILL");} catch {child.kill("SIGKILL");}}
    };
    const abort = () => {kill(); finish(signal.reason instanceof Error ? signal.reason : new Error("Capture cancelled"));};
    const timer = setTimeout(() => {kill(); finish(new Error("Capture helper timed out"));}, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {abort();}
    child.stdout.on("data", (value: Buffer) => {
      stdout += value.toString("utf8");
      if (Buffer.byteLength(stdout) > maxOutputBytes) {stdout = stdout.slice(-maxOutputBytes); kill(); finish(new Error("Capture helper exceeded its output limit"));}
    });
    child.stderr.on("data", (value: Buffer) => {stderr = (stderr + value.toString("utf8")).slice(-8192);});
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(`Capture helper failed (${code}): ${stderr.slice(-500)}`)));
  });
}

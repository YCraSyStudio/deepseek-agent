import { spawn } from "node:child_process";
import { WAYLAND_PORTAL_SCRIPT } from "./WaylandPortalScript";

/** Obtain one frame through the compositor's user-controlled source selector. */
export async function captureWaylandPortal(destination: string, screen: boolean, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const output = await runPortalHelper([destination, screen ? "1" : "2"], signal);
  const result: unknown = JSON.parse(output);
  if (!result || typeof result !== "object" || !("source_type" in result) || result.source_type !== (screen ? 1 : 2)) {
    throw new Error("Wayland portal returned an unexpected capture source");
  }
}

// Unlike noninteractive helpers, allow time for the chooser and close the request
// gracefully on cancellation before resorting to termination of our own child.
function runPortalHelper(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/python3", ["-I", "-u", "-c", WAYLAND_PORTAL_SCRIPT, ...args], {
      shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GST_DEBUG: "0" },
    });
    let stdout = ""; let stderr = ""; let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      if (killTimer) {return;}
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 4000);
    };
    const abort = () => stop(signal.reason instanceof Error ? signal.reason : new Error("Wayland capture cancelled"));
    const timeout = setTimeout(() => stop(new Error("Wayland desktop selector timed out")), 110_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {abort();}
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
      if (Buffer.byteLength(stdout) > 16 * 1024) {stdout = ""; stop(new Error("Wayland helper exceeded its output limit"));}
    });
    child.stderr.on("data", (data: Buffer) => {stderr = (stderr + data.toString("utf8")).slice(-8192);});
    child.on("error", (error) => {
      failure ??= new Error(`Cannot start Wayland capture: ${error.message}. System Python 3 with PyGObject/GStreamer is required.`);
    });
    child.on("close", (code) => {
      clearTimeout(timeout); if (killTimer) {clearTimeout(killTimer);}
      signal.removeEventListener("abort", abort);
      if (failure) {reject(failure);}
      else if (code !== 0) {reject(new Error(`Wayland capture failed: ${stderr.trim().slice(-1500) || `helper exited with ${code}`}`));}
      else {resolve(stdout);}
    });
  });
}

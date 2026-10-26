import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { captureWaylandPortal } from "@/infrastructure/capture/WaylandPortalCapture";

interface PortalEvent { event: string; address?: string; method?: string; interface?: string; options?: Record<string, unknown> }
const available = process.platform === "linux" && spawnSync("/usr/bin/python3", ["-I", "-c", "import gi; gi.require_version('Gst', '1.0'); from gi.repository import Gst; Gst.init(None); assert all(Gst.ElementFactory.find(n) for n in ('pipewiresrc','pngenc','videoconvert'))"], { stdio: "ignore" }).status === 0;

suite("Wayland desktop portal capture", () => {
  for (const [mode, error] of [
    ["cancel", /cancelled in the desktop selector/],
    ["wrong-scope", /unexpected capture source/],
    ["missing-scope", /unexpected capture source/],
    ["multiple", /unexpected capture source/],
    ["old", /version 3 or newer/],
    ["monitor-only", /cannot capture the requested source type/],
    ["stream-error", /No PipeWire stream/],
  ] as const) {
    test(`handles ${mode} without capturing unrelated screen contents`, async function () {
      if (!available) {this.skip();}
      this.timeout(10_000);
      await withPortal(mode, async ({ events, destination }) => {
        await assert.rejects(captureWaylandPortal(destination, false, new AbortController().signal), error);
        await assert.rejects(access(destination));
        const selected = events.find((event) => event.method === "SelectSources");
        if (selected) {
          assert.equal(selected.options?.types, 2); assert.equal(selected.options?.multiple, false);
          assert.equal(selected.options?.persist_mode, 0);
          assert.ok(events.some((event) => event.interface === "org.freedesktop.portal.Session"));
        }
        assert.equal(events.some((event) => event.event === "read-stream"), mode === "stream-error");
      });
    });
  }
  test("cancellation closes the open chooser and session before the helper exits", async function () {
    if (!available) {this.skip();}
    this.timeout(10_000);
    await withPortal("wait", async ({ events, destination, waitFor }) => {
      const abort = new AbortController();
      const pending = captureWaylandPortal(destination, false, abort.signal);
      const rejected = assert.rejects(pending, /QA cancelled/);
      await waitFor((event) => event.method === "Start");
      abort.abort(new Error("QA cancelled"));
      await rejected;
      assert.ok(events.some((event) => event.interface === "org.freedesktop.portal.Request"));
      assert.ok(events.some((event) => event.interface === "org.freedesktop.portal.Session"));
      await assert.rejects(access(destination));
    });
  });
  test("only an explicit screen request asks the portal for a monitor", async function () {
    if (!available) {this.skip();}
    this.timeout(10_000);
    await withPortal("cancel", async ({ events, destination }) => {
      await assert.rejects(captureWaylandPortal(destination, true, new AbortController().signal), /cancelled/);
      assert.equal(events.find((event) => event.method === "SelectSources")?.options?.types, 1);
    });
  });
});

async function withPortal(mode: string, check: (fixture: {
  events: PortalEvent[]; destination: string; waitFor: (match: (event: PortalEvent) => boolean) => Promise<PortalEvent>;
}) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "ycrasy-portal-test-"));
  const child = spawn("/usr/bin/python3", ["-I", path.resolve("src/test/fixtures/WaylandPortal.py"), mode], { stdio: ["ignore", "pipe", "pipe"] });
  const events: PortalEvent[] = []; let partial = ""; let stderr = "";
  const waiters = new Set<() => void>();
  child.stdout.on("data", (data: Buffer) => {
    partial += data.toString(); const lines = partial.split("\n"); partial = lines.pop()!;
    for (const line of lines) {if (line) {events.push(JSON.parse(line) as PortalEvent);}}
    for (const notify of waiters) {notify();}
  });
  child.stderr.on("data", (data: Buffer) => {stderr += data.toString();});
  const waitFor = (match: (event: PortalEvent) => boolean) => new Promise<PortalEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {waiters.delete(notify); reject(new Error(`Portal fixture did not respond: ${stderr}`));}, 5000);
    const notify = () => {const event = events.find(match); if (event) {clearTimeout(timeout); waiters.delete(notify); resolve(event);}};
    waiters.add(notify); notify();
  });
  const previous = process.env.DBUS_SESSION_BUS_ADDRESS;
  try {
    process.env.DBUS_SESSION_BUS_ADDRESS = (await waitFor((event) => event.event === "ready")).address;
    await check({ events, destination: path.join(directory, "capture.png"), waitFor });
  } finally {
    if (previous === undefined) {delete process.env.DBUS_SESSION_BUS_ADDRESS;} else {process.env.DBUS_SESSION_BUS_ADDRESS = previous;}
    const closed = once(child, "close"); child.kill("SIGTERM"); await closed;
    await rm(directory, { recursive: true, force: true });
  }
}

import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { listNativeWindows } from "@/infrastructure/capture/NativeWindowCatalog";

const require = createRequire(import.meta.url);
const children = require("node:child_process") as typeof import("node:child_process");

suite("native window catalog helper dispatch", () => {
  const originalSpawn = children.spawn;
  let platform: PropertyDescriptor; let environment: Map<string, string | undefined>;
  let calls: Array<{ executable: string; args: readonly string[] }>; let output: string;
  setup(() => {
    platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    environment = new Map(["DISPLAY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE"].map(key => [key, process.env[key]]));
    calls = []; output = "";
    children.spawn = ((executable: string, args: readonly string[], options: Parameters<typeof children.spawn>[2]) => {
      calls.push({ executable, args });
      return originalSpawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(output)})`], options);
    }) as typeof children.spawn;
    syncBuiltinESMExports();
  });
  teardown(() => {
    children.spawn = originalSpawn; syncBuiltinESMExports(); Object.defineProperty(process, "platform", platform);
    for (const [key, value] of environment) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
  });
  function host(value: string) { Object.defineProperty(process, "platform", { ...platform, value }); }
  test("uses the X11 helper and parses its exact window geometry", async () => {
    host("linux"); process.env.DISPLAY = ":fixture"; process.env.XDG_SESSION_TYPE = "x11"; delete process.env.WAYLAND_DISPLAY;
    output = "0x0123 0 123 -10 20 800 600 fixture Owned window";
    const windows = await listNativeWindows(new AbortController().signal);
    assert.deepEqual(calls, [{ executable: "wmctrl", args: ["-lpG"] }]);
    assert.deepEqual(windows[0], { id: "0x0123", pid: 123, title: "Owned window", x: -10, y: 20, width: 800, height: 600, visible: true });
  });
  for (const value of ["win32", "darwin"]) {
    test(`uses the ${value} platform helper and parses its JSON window catalog`, async () => {
      host(value); output = JSON.stringify([{ id: "123", pid: 123, title: "Owned", x: 0, y: 0, width: 10, height: 20, visible: true }]);
      const windows = await listNativeWindows(new AbortController().signal);
      assert.equal(windows[0].title, "Owned"); assert.equal(calls.length, 1);
      assert.equal(calls[0].executable, value === "win32" ? "powershell.exe" : "/usr/bin/osascript");
      assert.deepEqual(calls[0].args.slice(0, value === "win32" ? 3 : 4), value === "win32" ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-l", "JavaScript", "-e", calls[0].args[3]]);
    });
  }
  for (const wayland of ["session", "display"]) {
    test(`rejects Wayland ${wayland} detection before launching any helper`, async () => {
      host("linux"); process.env.XDG_SESSION_TYPE = wayland === "session" ? "wayland" : "x11";
      if (wayland === "display") { process.env.WAYLAND_DISPLAY = "wayland-1"; } else { delete process.env.WAYLAND_DISPLAY; }
      await assert.rejects(listNativeWindows(new AbortController().signal), /Wayland does not expose/); assert.equal(calls.length, 0);
    });
  }
  test("requires an X11 display and rejects unsupported platforms", async () => {
    host("linux"); delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY; process.env.XDG_SESSION_TYPE = "x11";
    await assert.rejects(listNativeWindows(new AbortController().signal), /X11 desktop display is required/);
    host("unsupported"); await assert.rejects(listNativeWindows(new AbortController().signal), /unsupported on this platform/); assert.equal(calls.length, 0);
  });
  test("does not launch a helper after cancellation", async () => {
    host("linux"); process.env.DISPLAY = ":fixture"; delete process.env.WAYLAND_DISPLAY; process.env.XDG_SESSION_TYPE = "x11";
    const controller = new AbortController(); controller.abort(new Error("catalog cancelled"));
    await assert.rejects(listNativeWindows(controller.signal), /catalog cancelled/); assert.equal(calls.length, 0);
  });
});

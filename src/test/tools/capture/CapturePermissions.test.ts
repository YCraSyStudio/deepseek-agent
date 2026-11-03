import assert from "node:assert/strict";
import { CapturePermissions, type CapturePermission } from "@/infrastructure/capture/CapturePermissions";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";

suite("Unified screenshot permissions", () => {
  function fixture(initial: CapturePermission = "ask", chooser = false) {
    let mode = initial; let approved = true; let prompts = 0; let captures = 0;
    let state: Parameters<ConstructorParameters<typeof CapturePermissions>[0]["save"]>[0] | undefined;
    const create = () => new CapturePermissions({ mode: () => mode, read: () => state, save: async value => {state = value;},
      confirm: async () => {prompts++; return approved;}, systemChooser: () => chooser,
      application: async pid => pid === 30 ? "/other/app" : "/same/app", debugPid: () => 10 });
    const permissions = create();
    const capture = (request: CaptureScreenshotRequest, policy = permissions, signal = new AbortController().signal) => policy.wrap({ capture: async () => {captures++; return { bytes: Buffer.from("png"), target: "fixture" };} }).capture(request, signal);
    return { permissions, create, capture, setMode: (value: CapturePermission) => {mode = value;}, deny: () => {approved = false;},
      prompts: () => prompts, captures: () => captures, state: () => state };
  }
  const web = { target: "web", url: "https://example.test/a" } as const;
  test("default asks for every web, app, debug and screen capture", async () => {
    const f = fixture();
    for (const request of [web, web, { target: "window", window: "Editor" }, { target: "debug" }, { target: "screen" }] as CaptureScreenshotRequest[]) {await f.capture(request);}
    assert.equal(f.prompts(), 5); assert.equal(f.captures(), 5);
  });
  test("first use remembers each exact URL across reload and separates new routes", async () => {
    const f = fixture("first-use");
    await Promise.all([f.capture(web), f.capture(web)]);
    await f.capture(web, f.create());
    assert.equal(f.prompts(), 1);
    await f.capture({ ...web, url: "https://example.test/b" });
    assert.equal(f.prompts(), 2);
    assert.ok(f.state()?.views?.every(value => /^[a-f0-9]{64}$/.test(value)));
  });
  test("first use identifies applications independently of changing process IDs", async () => {
    const f = fixture("first-use");
    await f.capture({ target: "window", process: "10" });
    await f.capture({ target: "window", process: "20" });
    await f.capture({ target: "debug" });
    await f.capture({ target: "window", process: "30" });
    assert.equal(f.prompts(), 2);
  });
  test("always skips prompts and switching back to ask takes effect immediately", async () => {
    const f = fixture("always");
    await f.capture(web); await f.capture({ target: "screen" }); assert.equal(f.prompts(), 0);
    f.setMode("ask"); await f.capture(web); assert.equal(f.prompts(), 1);
  });
  test("denial and cancellation never capture or remember permission", async () => {
    const f = fixture("first-use"); f.deny();
    await assert.rejects(f.capture(web), /not authorized/);
    const abort = new AbortController(); abort.abort(new Error("Cancelled"));
    await assert.rejects(f.capture(web, f.permissions, abort.signal), /Cancelled/);
    assert.equal(f.captures(), 0); assert.equal(f.state(), undefined);
  });
  test("Wayland uses one system selector and rotates remembered authorization across reload", async () => {
    const f = fixture("first-use", true);
    const request = { target: "window", window: "Editor" } as const;
    await f.capture(request); assert.equal(f.prompts(), 0);
    const first = await f.permissions.portalOptions(request);
    assert.equal(first.persistent, true); assert.equal(first.restoreToken, undefined);
    await first.onRestoreToken!("first-token");
    const restored = await f.create().portalOptions(request);
    assert.equal(restored.restoreToken, "first-token");
    await restored.onRestoreToken!("rotated-token");
    assert.equal((await f.create().portalOptions(request)).restoreToken, "rotated-token");
    assert.equal((await f.permissions.portalOptions({ target: "window", window: "Other app" })).restoreToken, undefined);
    f.setMode("ask"); assert.deepEqual(await f.create().portalOptions(request), { persistent: false });
    f.setMode("always"); assert.equal((await f.create().portalOptions(request)).restoreToken, "rotated-token");
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromiumProvider, type ChromiumBinary, type ChromiumDistribution } from "@/infrastructure/browser/ChromiumProvider";

suite("Managed Chromium selection and updates", () => {
  let root: string;
  const signal = new AbortController().signal;
  setup(async () => {root = await mkdtemp(join(tmpdir(), "chromium-provider-test-"));});
  teardown(async () => {await rm(root, { recursive: true, force: true });});
  const unavailable = async () => undefined;
  function distribution() {
    const installed: ChromiumBinary[] = [];
    let latest = "150.0.1.0";
    let checks = 0;
    let downloads = 0;
    let offline = false;
    let retained: readonly string[] = [];
    const backend: ChromiumDistribution = {
      installed: async () => installed,
      cleanup: async (keep) => {retained = keep;},
      latest: async () => {checks++; if (offline) {throw new Error("offline");} return latest;},
      install: async (buildId) => {
        downloads++;
        const executablePath = join(root, buildId);
        await writeFile(executablePath, "test binary"); await chmod(executablePath, 0o700);
        const entry = { buildId, executablePath }; installed.push(entry); return entry;
      },
    };
    return { backend, installed, setLatest: (value: string) => {latest = value;}, goOffline: () => {offline = true;},
      checks: () => checks, downloads: () => downloads, retained: () => retained };
  }

  test("uses a user browser without checking or downloading a managed binary", async () => {
    const state = distribution();
    const provider = new ChromiumProvider(root, undefined, state.backend, async () => "/user/chrome");
    assert.equal(await provider.executable(signal), "/user/chrome");
    assert.equal(state.checks(), 0); assert.equal(state.downloads(), 0);
  });

  test("shares installation, persists daily checks across restarts and installs new stable releases", async () => {
    const state = distribution();
    let now = Date.now();
    const provider = () => new ChromiumProvider(root, undefined, state.backend, unavailable, () => now);
    const first = provider();
    const [capture, read] = await Promise.all([first.executable(signal), first.executable(signal)]);
    assert.equal(capture, read); assert.equal(state.downloads(), 1);
    await provider().executable(signal); assert.equal(state.checks(), 1);
    state.setLatest("151.0.0.0"); now += 24 * 60 * 60_000;
    assert.equal(await provider().executable(signal), join(root, "151.0.0.0"));
    assert.equal(state.downloads(), 2);
    assert.deepEqual(state.retained(), ["151.0.0.0", "150.0.1.0"]);
    assert.equal(JSON.parse(await readFile(join(root, "update-check.json"), "utf8")).checkedAt, now);
  });

  test("retains the working installed version offline and backs off update checks", async () => {
    const state = distribution(); let now = Date.now();
    const provider = new ChromiumProvider(root, undefined, state.backend, unavailable, () => now);
    const first = await provider.executable(signal);
    now += 24 * 60 * 60_000; state.goOffline();
    assert.equal(await provider.executable(signal), first);
    assert.equal(await provider.executable(signal), first);
    assert.equal(state.checks(), 2); assert.equal(state.downloads(), 1);
  });

  test("ignores missing executables and reports an actionable first-install failure", async () => {
    const state = distribution(); state.goOffline();
    state.installed.push({ buildId: "999", executablePath: join(root, "missing") });
    await assert.rejects(new ChromiumProvider(root, undefined, state.backend, unavailable).executable(signal), /Could not install.*network access/);
  });

  test("cancelling one caller leaves a shared installation available to other callers", async () => {
    let release!: () => void;
    let started!: () => void;
    const installing = new Promise<void>((resolve) => {started = resolve;});
    const gate = new Promise<void>((resolve) => {release = resolve;});
    const backend: ChromiumDistribution = {
      installed: async () => [], latest: async () => "150.0.1.0",
      install: async (buildId) => {started(); await gate; return { executablePath: process.execPath, buildId };},
    };
    const provider = new ChromiumProvider(root, undefined, backend, unavailable);
    const controller = new AbortController();
    const capture = provider.executable(controller.signal);
    const read = provider.executable(signal);
    await installing;
    controller.abort(new Error("capture cancelled"));
    await assert.rejects(capture, /capture cancelled/);
    release();
    assert.equal(await read, process.execPath);
  });

  test("cancelled callers do not trigger a browser lookup", async () => {
    let calls = 0;
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    const provider = new ChromiumProvider(root, undefined, distribution().backend, async () => {calls++; return undefined;});
    await assert.rejects(provider.executable(controller.signal), /cancelled/);
    assert.equal(calls, 0);
  });
});

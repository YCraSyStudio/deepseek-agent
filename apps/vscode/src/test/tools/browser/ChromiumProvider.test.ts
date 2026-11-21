import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Browser, computeExecutablePath, detectBrowserPlatform } from "@puppeteer/browsers";
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

  for (const platform of ["darwin", "win32"] as const) {
    test(`discovers ${platform} browser candidates through the host platform boundary`, async function () {
      if (process.platform === "win32" && platform === "darwin") { this.skip(); }
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
      const keys = ["PATH", "PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] as const;
      const original = new Map(keys.map(key => [key, process.env[key]]));
      const browser = platform === "win32" ? join(root, "Google/Chrome/Application/chrome.exe") : join(root, "google-chrome");
      await mkdir(dirname(browser), { recursive: true });
      await writeFile(browser, "#!/bin/sh\necho 'Google Chrome 150.0.1.0'\n"); await chmod(browser, 0o755);
      try {
        process.env.PATH = platform === "win32" ? "" : root;
        process.env.PROGRAMFILES = root; delete process.env["PROGRAMFILES(X86)"]; delete process.env.LOCALAPPDATA;
        Object.defineProperty(process, "platform", { ...platformDescriptor, value: platform });
        const state = distribution();
        assert.equal(await new ChromiumProvider(root, undefined, state.backend).executable(signal), browser);
        assert.equal(state.checks(), 0); assert.equal(state.downloads(), 0);
      } finally {
        Object.defineProperty(process, "platform", platformDescriptor);
        for (const [key, value] of original) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
      }
    });
  }

  test("installs the managed fallback when the system search has no candidates", async () => {
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = "";
      const state = distribution();
      assert.equal(await new ChromiumProvider(root, undefined, state.backend, unavailable).executable(signal), join(root, "150.0.1.0"));
      assert.equal(state.downloads(), 1);
    } finally { if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; } }
  });

  test("cancels when system discovery aborts before the abort listener can be attached", async () => {
    const controller = new AbortController();
    const provider = new ChromiumProvider(root, undefined, distribution().backend, async () => { controller.abort(new Error("lookup cancelled")); return process.execPath; });
    await assert.rejects(provider.executable(controller.signal), /lookup cancelled/);
  });
  test("rejects invalid stable metadata and preserves non-Error download failures", async () => {
    const state = distribution(); state.setLatest("invalid-version");
    await assert.rejects(new ChromiumProvider(root, undefined, state.backend, unavailable).executable(signal), /Invalid Chromium stable version metadata/);
    state.backend.latest = async () => { throw "offline"; };
    await assert.rejects(new ChromiumProvider(root, undefined, state.backend, unavailable).executable(signal), /Could not install.*extension host\. $/);
  });
  test("rechecks an expired cached release without downloading the same version again", async () => {
    const state = distribution(); let now = Date.now();
    const provider = new ChromiumProvider(root, undefined, state.backend, unavailable, () => now);
    await provider.executable(signal); now += 24 * 60 * 60_000;
    assert.equal(await provider.executable(signal), join(root, "150.0.1.0"));
    assert.equal(state.checks(), 2); assert.equal(state.downloads(), 1);
  });
  test("skips a non-browser executable and a non-executable file before accepting Chromium", async function () {
    if (process.platform === "win32") { this.skip(); }
    const previousPath = process.env.PATH;
    for (const [name, content, mode] of [["google-chrome", "Netscape", 0o755], ["google-chrome-stable", "Chrome 150", 0o644], ["chromium", "Chromium 150.0.0.0", 0o755]] as const) {
      const file = join(root, name); await writeFile(file, `#!/bin/sh\necho '${content}'\n`); await chmod(file, mode);
    }
    try {
      process.env.PATH = root;
      assert.equal(await new ChromiumProvider(root, undefined, distribution().backend).executable(signal), join(root, "chromium"));
    } finally { if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; } }
  });
  test("supports hosts with no PATH configured by installing a managed fallback", async () => {
    const previousPath = process.env.PATH;
    try {
      delete process.env.PATH;
      const state = distribution();
      assert.equal(await new ChromiumProvider(root, undefined, state.backend, unavailable).executable(signal), join(root, "150.0.1.0"));
    } finally { if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; } }
  });

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

  test("finds a working system browser on PATH and skips invalid candidates", async function () {
    if (process.platform === "win32") { this.skip(); }
    const binDirectory = join(root, "bin");
    await mkdir(binDirectory, { recursive: true });
    const browser = join(binDirectory, "google-chrome");
    await writeFile(browser, "#!/bin/sh\necho 'Google Chrome 150.0.1.0'\n");
    await chmod(browser, 0o755);
    const notABrowser = join(binDirectory, "chromium");
    await writeFile(notABrowser, "#!/bin/sh\necho 'Netscape'\n");
    await chmod(notABrowser, 0o755);
    const notExecutable = join(binDirectory, "google-chrome-stable");
    await writeFile(notExecutable, "#!/bin/sh\necho 'Google Chrome 150.0.1.0'\n");
    await chmod(notExecutable, 0o644);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDirectory}${delimiter}${previousPath ?? ""}`;
    try {
      assert.equal(await new ChromiumProvider(root).executable(signal), browser);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test("reuses a cached managed installation from the default distribution", async () => {
    const platform = detectBrowserPlatform();
    assert.ok(platform);
    const buildId = "150.0.1.0";
    const executablePath = computeExecutablePath({ cacheDir: root, browser: Browser.CHROMEHEADLESSSHELL, buildId, platform });
    await mkdir(dirname(executablePath), { recursive: true });
    await writeFile(executablePath, "cached binary");
    await chmod(executablePath, 0o755);
    const now = Date.now();
    await writeFile(join(root, "update-check.json"), JSON.stringify({ checkedAt: now }));

    const provider = new ChromiumProvider(root, undefined, undefined, async () => undefined, () => now);
    assert.equal(await provider.executable(signal), executablePath);
  });
});

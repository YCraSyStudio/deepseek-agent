import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ChromiumProvider } from "@/infrastructure/browser/ChromiumProvider";
import { distributionState as state, computeExecutablePath, Browser } from "../../../support/PuppeteerDistributionMock";

suite("managed Chromium distribution boundary", () => {
  let root: string;
  setup(async () => { state.reset(); root = await mkdtemp(path.join(tmpdir(), "chromium-distribution-")); });
  teardown(async () => { await rm(root, { recursive: true, force: true }); state.reset(); });
  const provider = () => new ChromiumProvider(root, undefined, undefined, async () => undefined);
  const executable = () => computeExecutablePath({ cacheDir: root, platform: "linux", browser: Browser.CHROMEHEADLESSSHELL, buildId: state.latest });
  async function assertStagingRemoved() {
    assert.equal(state.staging.length, 1);
    await assert.rejects(stat(state.staging[0]), { code: "ENOENT" });
  }
  test("publishes the downloaded executable atomically and removes only obsolete matching releases", async () => {
    for (const buildId of ["149.0.0.0", "150.0.0.0"]) {
      const executablePath = computeExecutablePath({ cacheDir: root, platform: "linux", browser: Browser.CHROMEHEADLESSSHELL, buildId });
      await mkdir(path.dirname(executablePath), { recursive: true }); await writeFile(executablePath, "cached"); await chmod(executablePath, 0o700);
      state.entries.push({ browser: Browser.CHROMEHEADLESSSHELL, platform: "linux", buildId, executablePath });
    }
    state.entries.push({ browser: "firefox", platform: "linux", buildId: "1", executablePath: "unrelated" },
      { browser: Browser.CHROMEHEADLESSSHELL, platform: "mac", buildId: "2", executablePath: "other-platform" });
    assert.equal(await provider().executable(new AbortController().signal), executable());
    assert.equal(await readFile(executable(), "utf8"), "managed binary");
    assert.deepEqual(state.removed, ["149.0.0.0"]); await assertStagingRemoved();
  });
  test("accepts a complete matching installation published by another editor window", async () => {
    state.mode = "competing-install";
    assert.equal(await provider().executable(new AbortController().signal), executable());
    assert.equal(await readFile(executable(), "utf8"), "other window binary"); await assertStagingRemoved();
  });
  for (const mode of ["broken-destination", "download-failure"] as const) {
    test(`preserves installation errors and removes staging after ${mode}`, async () => {
      state.mode = mode;
      await assert.rejects(provider().executable(new AbortController().signal), /Could not install Chrome Headless Shell/);
      await assertStagingRemoved();
    });
  }
  for (const platform of [undefined, "linux_arm"]) {
    test(`reports unsupported managed distributions for platform=${String(platform)}`, async () => {
      state.platform = platform;
      await assert.rejects(provider().executable(new AbortController().signal), /No managed Chromium build is available/);
      assert.deepEqual(state.installs, []);
    });
  }
  test("cleanup failures do not discard a successfully installed browser", async () => {
    state.cleanupFailure = true;
    state.entries = [{ browser: Browser.CHROMEHEADLESSSHELL, platform: "linux", buildId: "140.0.0.0", executablePath: "missing" },
      { browser: Browser.CHROMEHEADLESSSHELL, platform: "linux", buildId: "139.0.0.0", executablePath: "missing" }];
    assert.equal(await provider().executable(new AbortController().signal), executable());
    assert.deepEqual(state.removed, ["139.0.0.0"]); await assertStagingRemoved();
  });
});

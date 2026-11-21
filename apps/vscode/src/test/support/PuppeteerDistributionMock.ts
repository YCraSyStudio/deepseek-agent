import { chmod, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const Browser = { CHROMEHEADLESSSHELL: "chrome-headless-shell" };
export const BrowserPlatform = { LINUX_ARM: "linux_arm", LINUX: "linux" };
export const ChromeReleaseChannel = { STABLE: "stable" };
type Entry = { browser: string; platform: string; buildId: string; executablePath: string };
export const distributionState = {
  platform: "linux" as string | undefined,
  entries: [] as Entry[], latest: "151.0.0.0", installs: [] as string[], removed: [] as string[], staging: [] as string[],
  mode: "normal" as "normal" | "competing-install" | "broken-destination" | "download-failure",
  cleanupFailure: false,
  reset() {
    this.platform = "linux"; this.entries = []; this.latest = "151.0.0.0"; this.installs = []; this.removed = []; this.staging = [];
    this.mode = "normal"; this.cleanupFailure = false;
  },
};
export const detectBrowserPlatform = () => distributionState.platform;
export const getInstalledBrowsers = async (_options: { cacheDir: string }) => distributionState.entries;
export const resolveBuildId = async (_browser: string, _platform: string, _channel: string) => distributionState.latest;
export function computeExecutablePath({ cacheDir, platform, browser, buildId }: { cacheDir: string; platform?: string; browser: string; buildId: string }) {
  return path.join(cacheDir, browser, `${platform}-${buildId}`, "bin", "chrome");
}
export async function install(options: { cacheDir: string; platform?: string; browser: string; buildId: string }) {
  distributionState.installs.push(options.buildId); distributionState.staging.push(options.cacheDir);
  if (distributionState.mode === "download-failure") { throw new Error("download unavailable"); }
  const executablePath = computeExecutablePath(options);
  await mkdir(path.dirname(executablePath), { recursive: true }); await writeFile(executablePath, "managed binary"); await chmod(executablePath, 0o700);
  if (distributionState.mode === "competing-install" || distributionState.mode === "broken-destination") {
    const destination = computeExecutablePath({ ...options, cacheDir: path.dirname(options.cacheDir) });
    await mkdir(path.dirname(destination), { recursive: true });
    if (distributionState.mode === "competing-install") { await writeFile(destination, "other window binary"); await chmod(destination, 0o700); }
    else { await writeFile(path.join(path.dirname(destination), "incomplete"), "incomplete install"); }
  }
  return { path: path.dirname(path.dirname(executablePath)), executablePath };
}
export async function uninstall({ buildId }: { cacheDir: string; platform: string; browser: string; buildId: string }) {
  distributionState.removed.push(buildId);
  if (distributionState.cleanupFailure) { throw new Error("old browser in use"); }
}

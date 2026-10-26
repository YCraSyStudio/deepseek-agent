import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile, mkdtemp, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { Browser, ChromeReleaseChannel, computeExecutablePath, BrowserPlatform, detectBrowserPlatform, getInstalledBrowsers, install, resolveBuildId, uninstall } from "@puppeteer/browsers";

const run = promisify(execFile);
const DAY = 24 * 60 * 60_000;
export interface ChromiumBinary { executablePath: string; buildId: string }
export interface ChromiumDistribution {
  installed(): Promise<ChromiumBinary[]>;
  latest(): Promise<string>;
  install(buildId: string): Promise<ChromiumBinary>;
  cleanup?(keep: readonly string[]): Promise<void>;
}
export type BrowserProgress = <T>(task: () => Promise<T>) => Promise<T>;

/** One resolver shared by web reads and screenshots. User browsers are never updated here. */
export class ChromiumProvider {
  private pending?: Promise<string>;
  private readonly distribution: ChromiumDistribution;
  constructor(private readonly cacheDir: string, private readonly progress: BrowserProgress = (task) => task(),
    distribution?: ChromiumDistribution, private readonly findSystem = findSystemChromium, private readonly now = Date.now) {
    const platform = detectBrowserPlatform();
    this.distribution = distribution ?? {
      installed: async () => (await getInstalledBrowsers({ cacheDir })).filter((entry) =>
        entry.browser === Browser.CHROMEHEADLESSSHELL && entry.platform === platform),
      latest: async () => {
        if (!platform || platform === BrowserPlatform.LINUX_ARM) {throw new Error(`No managed Chromium build is available for ${process.platform}/${process.arch}. Install a Chromium browser on this extension host.`);}
        return resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, ChromeReleaseChannel.STABLE);
      },
      cleanup: async (keep) => {
        const entries = await getInstalledBrowsers({ cacheDir });
        for (const entry of entries) {
          if (entry.browser === Browser.CHROMEHEADLESSSHELL && entry.platform === platform && !keep.includes(entry.buildId)) {
            await uninstall({ cacheDir, platform: entry.platform, browser: entry.browser, buildId: entry.buildId }).catch(() => undefined);
          }
        }
      },
      install: async (buildId) => {
        const staging = await mkdtemp(path.join(cacheDir, ".download-"));
        try {
          const browser = await install({ cacheDir: staging, platform, browser: Browser.CHROMEHEADLESSSHELL, buildId, installDeps: false });
          const executablePath = computeExecutablePath({ cacheDir, platform, browser: Browser.CHROMEHEADLESSSHELL, buildId });
          const destination = path.join(cacheDir, Browser.CHROMEHEADLESSSHELL, `${platform}-${buildId}`);
          await mkdir(path.dirname(destination), { recursive: true });
          try {await rename(browser.path, destination);}
          catch (error) {
            // Another editor window may have installed this exact version while we downloaded.
            try {await access(executablePath, constants.X_OK);} catch {throw error;}
          }
          return { executablePath, buildId };
        } finally {await rm(staging, { recursive: true, force: true });}
      },
    };
  }

  async executable(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const pending = this.pending ??= this.resolve().finally(() => {this.pending = undefined;});
    // A caller can cancel without interrupting another caller's shared browser installation.
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {abort();}
      void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async resolve(): Promise<string> {
    const system = await this.findSystem();
    if (system) {return system;}
    await mkdir(this.cacheDir, { recursive: true });
    const installed = (await this.distribution.installed()).sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));
    let cached: ChromiumBinary | undefined;
    for (const entry of installed) {
      try {await access(entry.executablePath, constants.X_OK); cached = entry; break;} catch { /* Ignore incomplete installations. */ }
    }
    const statePath = path.join(this.cacheDir, "update-check.json");
    let checkedAt = 0;
    try {checkedAt = JSON.parse(await readFile(statePath, "utf8")).checkedAt;} catch { /* First use or interrupted metadata write. */ }
    if (cached && Number.isFinite(checkedAt) && this.now() >= checkedAt && this.now() - checkedAt < DAY) {return cached.executablePath;}
    try {
      return await this.progress(async () => {
        const latest = await this.distribution.latest();
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(latest)) {throw new Error("Invalid Chromium stable version metadata");}
        const browser = cached?.buildId === latest ? cached : await this.distribution.install(latest);
        await access(browser.executablePath, constants.X_OK);
        await writeFile(statePath, JSON.stringify({ checkedAt: this.now() }));
        // Keep the previous release for any operation still finishing during the update.
        const previous = installed.find((entry) => entry.buildId !== browser.buildId)?.buildId;
        await this.distribution.cleanup?.([browser.buildId, ...(previous ? [previous] : [])]).catch(() => undefined);
        return browser.executablePath;
      });
    } catch (error) {
      if (cached) {
        // Retry in an hour, rather than retrying on every screenshot while offline.
        await writeFile(statePath, JSON.stringify({ checkedAt: this.now() - DAY + 60 * 60_000 })).catch(() => undefined);
        return cached.executablePath;
      }
      throw new Error(`Could not install Chrome Headless Shell. Check network access and free disk space, or install Chrome, Chromium or Edge on this extension host. ${error instanceof Error ? error.message : ""}`);
    }
  }
}

async function findSystemChromium(): Promise<string | undefined> {
  const names = process.platform === "win32" ? ["chrome.exe", "msedge.exe", "brave.exe", "vivaldi.exe", "chromium.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser", "vivaldi-stable"];
  const candidates = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap((directory) => names.map((name) => path.join(directory, name)));
  if (process.platform === "darwin") {
    for (const root of ["/Applications", path.join(process.env.HOME ?? "", "Applications")]) {
      for (const [app, binary] of [["Google Chrome", "Google Chrome"], ["Microsoft Edge", "Microsoft Edge"], ["Chromium", "Chromium"], ["Brave Browser", "Brave Browser"], ["Vivaldi", "Vivaldi"]]) {
        candidates.push(path.join(root, `${app}.app`, "Contents", "MacOS", binary!));
      }
    }
  }
  if (process.platform === "win32") {
    for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter((value): value is string => !!value)) {
      for (const relative of ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe", "BraveSoftware/Brave-Browser/Application/brave.exe", "Vivaldi/Application/vivaldi.exe"]) {
        candidates.push(path.join(root, relative));
      }
    }
  }
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      // Windows GUI binaries do not consistently print --version; CDP verifies their identity at launch.
      if (process.platform !== "win32") {
        const { stdout } = await run(candidate, ["--version"], { timeout: 3000, maxBuffer: 4096, windowsHide: true });
        if (!/(?:Chrome|Chromium|Edge|Brave|Vivaldi)\s[\d.]+/i.test(stdout)) {continue;}
      }
      return candidate;
    } catch {continue;}
  }
  return undefined;
}

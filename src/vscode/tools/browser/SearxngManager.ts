import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { AppConfig } from "@/contracts";
import { normalizeSearxngEndpoint } from "@/infrastructure/browser/SearxngSearch";
import {
  MAX_SEARXNG_RUNTIME_BYTES,
  SEARXNG_RUNTIME_RELEASE_BASE_URL,
  SEARXNG_RUNTIME_VERSION,
  expectedSearxngRuntimeAssetName,
  parseSearxngRuntimeManifest,
  resolveSearxngRuntimeAsset,
  type SearxngRuntimeAsset,
  type SearxngRuntimePlatformKey,
} from "@/infrastructure/browser/SearxngRuntimeManifest";
import { withFileLock, writeJsonFileAtomic } from "@/infrastructure/persistence/JsonFileStorage";
import { getUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";

const READY_ATTEMPTS = 360;
const READY_INTERVAL_MS = 250;
const PROCESS_STOP_TIMEOUT_MS = 4_000;
const MAX_LOG_TAIL_CHARS = 12_000;
const MANIFEST_TIMEOUT_MS = 30_000;
const RUNTIME_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

type SearxngRuntimeConfig = Pick<AppConfig, "webSearchEnabled" | "webSearchEngine" | "searxngUrl">;

interface ManagedInstance {
  endpoint: string;
  child: ChildProcess;
  executable: string;
  platformKey: SearxngRuntimePlatformKey;
  startedAt: number;
  logTail: string;
}

interface LocalEndpoint {
  endpoint: string;
  port: number;
}

interface InstalledRuntime {
  executable: string;
  platformKey: SearxngRuntimePlatformKey;
}

interface InstalledRuntimeMetadata {
  runtime_version: string;
  platform_key: SearxngRuntimePlatformKey;
  asset_name: string;
  sha256: string;
  size: number;
}

export class SearxngManager implements vscode.Disposable {
  private managed?: ManagedInstance;
  private resolving?: Promise<string>;
  private resolvingEndpoint?: string;
  private syncQueue: Promise<void> = Promise.resolve();
  private readonly output = vscode.window.createOutputChannel("YCraSy DeepSeek Agent · SearXNG");

  constructor(_context: vscode.ExtensionContext) {}

  sync(config: SearxngRuntimeConfig): Promise<void> {
    const snapshot = { ...config };
    const operation = this.syncQueue.then(
      () => this.syncInternal(snapshot),
      () => this.syncInternal(snapshot),
    );
    this.syncQueue = operation.catch(() => undefined);
    return operation;
  }

  async resolve(configuredUrl: string): Promise<string> {
    const normalized = normalizedEndpoint(configuredUrl);
    if (await isSearxngAvailable(normalized)) {return normalized;}

    const local = getManagedLocalEndpoint(normalized);
    if (!local) {throw new Error(`Configured SearXNG endpoint is unavailable: ${normalized}`);}
    if (this.managed?.endpoint === local.endpoint && await isSearxngAvailable(local.endpoint)) {
      return local.endpoint;
    }
    if (this.resolving) {
      if (this.resolvingEndpoint === local.endpoint) {return this.resolving;}
      await this.resolving.catch(() => undefined);
      return this.resolve(configuredUrl);
    }

    const startup = vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Starting local SearXNG on 127.0.0.1:${local.port}`,
      cancellable: false,
    }, async () => this.ensureManaged(local));
    this.resolvingEndpoint = local.endpoint;
    this.resolving = Promise.resolve(startup).finally(() => {
      this.resolving = undefined;
      this.resolvingEndpoint = undefined;
    });
    return this.resolving;
  }

  async stopManaged(): Promise<void> {
    const current = this.managed;
    this.managed = undefined;
    if (!current) {return;}
    this.output.appendLine(`[runtime] stopping pid=${current.child.pid ?? "unknown"} endpoint=${current.endpoint}`);
    await terminateChild(current.child);
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      managed: this.managed !== undefined,
      endpoint: this.managed?.endpoint,
      pid: this.managed?.child.pid,
      executable: this.managed?.executable,
      platform: this.managed?.platformKey ?? safeRuntimePlatformKey(),
      runtimeVersion: SEARXNG_RUNTIME_VERSION,
      provider: "downloaded-sidecar",
      startedAt: this.managed?.startedAt,
    };
  }

  dispose(): void {
    const current = this.managed;
    this.managed = undefined;
    if (current?.child.exitCode === null) {current.child.kill();}
    this.output.dispose();
  }

  private async syncInternal(config: SearxngRuntimeConfig): Promise<void> {
    if (!config.webSearchEnabled || config.webSearchEngine !== "searxng") {
      await this.stopManaged();
      return;
    }

    const endpoint = normalizedEndpoint(config.searxngUrl);
    const local = getManagedLocalEndpoint(endpoint);
    if (!local) {
      await this.stopManaged();
      return;
    }

    if (await isSearxngAvailable(local.endpoint)) {
      if (this.managed && this.managed.endpoint !== local.endpoint) {await this.stopManaged();}
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: this.managed
        ? `Restarting local SearXNG on 127.0.0.1:${local.port}`
        : `Starting local SearXNG on 127.0.0.1:${local.port}`,
      cancellable: false,
    }, async () => this.ensureManaged(local));
  }

  private async ensureManaged(target: LocalEndpoint): Promise<string> {
    const previous = this.managed;
    if (previous?.endpoint === target.endpoint && await isSearxngAvailable(target.endpoint)) {
      return target.endpoint;
    }
    if (previous) {await this.stopManaged();}

    const runtime = await this.ensureRuntimeInstalled();
    const stateDirectory = path.join(getUserDataDirectory(), "runtime-state", "searxng");
    const cacheDirectory = path.join(stateDirectory, "cache");
    const settingsPath = path.join(stateDirectory, "settings.yml");
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(settingsPath, createSettings(target.port), { encoding: "utf8", mode: 0o600 });

    this.output.appendLine(`[runtime] starting ${runtime.executable}`);
    this.output.appendLine(`[runtime] endpoint=${target.endpoint} platform=${runtime.platformKey}`);
    const child = spawn(runtime.executable, [], {
      cwd: path.dirname(runtime.executable),
      env: {
        ...process.env,
        SEARXNG_SETTINGS_PATH: settingsPath,
        XDG_CACHE_HOME: cacheDirectory,
        PYTHONUNBUFFERED: "1",
      },
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const candidate: ManagedInstance = {
      endpoint: target.endpoint,
      child,
      executable: runtime.executable,
      platformKey: runtime.platformKey,
      startedAt: Date.now(),
      logTail: "",
    };
    this.managed = candidate;
    this.attachProcessLogs(candidate);

    try {
      await waitUntilReady(target.endpoint, child);
      this.output.appendLine(`[runtime] ready ${target.endpoint}`);
      return target.endpoint;
    } catch (error: unknown) {
      if (this.managed === candidate) {this.managed = undefined;}
      await terminateChild(child);
      const message = error instanceof Error ? error.message : String(error);
      const details = candidate.logTail.trim();
      throw new Error(details ? `${message}\nSearXNG log tail:\n${details}` : message);
    }
  }

  private attachProcessLogs(instance: ManagedInstance): void {
    const append = (source: "stdout" | "stderr", chunk: unknown): void => {
      const text = String(chunk);
      instance.logTail = `${instance.logTail}${text}`.slice(-MAX_LOG_TAIL_CHARS);
      for (const line of text.split(/\r?\n/).filter(Boolean)) {this.output.appendLine(`[${source}] ${line}`);}
    };
    instance.child.stdout?.setEncoding("utf8");
    instance.child.stderr?.setEncoding("utf8");
    instance.child.stdout?.on("data", (chunk) => append("stdout", chunk));
    instance.child.stderr?.on("data", (chunk) => append("stderr", chunk));
    instance.child.once("error", (error) => append("stderr", `process error: ${error.message}`));
    instance.child.once("exit", (code, signal) => {
      this.output.appendLine(`[runtime] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (this.managed === instance) {this.managed = undefined;}
    });
  }

  private async ensureRuntimeInstalled(): Promise<InstalledRuntime> {
    const platformKey = runtimePlatformKey();
    const root = path.join(getUserDataDirectory(), "runtimes", "searxng", SEARXNG_RUNTIME_VERSION, platformKey);
    const executable = path.join(root, expectedSearxngRuntimeAssetName(platformKey));
    const metadataPath = path.join(root, "install.json");
    const existing = await readInstalledRuntimeMetadata(metadataPath);
    if (existing && await verifyInstalledRuntime(executable, existing, platformKey)) {
      await ensureExecutable(executable);
      return { executable, platformKey };
    }

    return withFileLock(metadataPath, async () => {
      const lockedExisting = await readInstalledRuntimeMetadata(metadataPath);
      if (lockedExisting && await verifyInstalledRuntime(executable, lockedExisting, platformKey)) {
        await ensureExecutable(executable);
        return { executable, platformKey };
      }

      return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Installing SearXNG runtime for ${platformKey}`,
        cancellable: false,
      }, async (progress) => {
        progress.report({ message: "Reading signed release manifest…" });
        const manifest = await downloadRuntimeManifest();
        const asset = resolveSearxngRuntimeAsset(manifest, platformKey);
        progress.report({ message: `Downloading ${formatBytes(asset.size)}…` });
        const bytes = await downloadRuntimeAsset(asset);
        const temporary = path.join(root, `.${asset.name}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
        await mkdir(root, { recursive: true });
        try {
          await writeFile(temporary, bytes, { mode: process.platform === "win32" ? 0o600 : 0o700 });
          if (process.platform !== "win32") {await chmod(temporary, 0o755);}
          await rm(executable, { force: true });
          await rename(temporary, executable);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }
        await ensureExecutable(executable);
        const metadata: InstalledRuntimeMetadata = {
          runtime_version: SEARXNG_RUNTIME_VERSION,
          platform_key: platformKey,
          asset_name: asset.name,
          sha256: asset.sha256,
          size: asset.size,
        };
        await writeJsonFileAtomic(metadataPath, metadata);
        this.output.appendLine(`[runtime] installed ${SEARXNG_RUNTIME_VERSION} (${platformKey})`);
        return { executable, platformKey };
      });
    });
  }
}

function getManagedLocalEndpoint(value: string): LocalEndpoint | undefined {
  const url = normalizeSearxngEndpoint(value);
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1";
  if (url.protocol !== "http:" || !loopback) {return undefined;}
  if (url.pathname && url.pathname !== "/") {return undefined;}
  const port = url.port ? Number(url.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {return undefined;}
  return { endpoint: `http://127.0.0.1:${port}`, port };
}

function normalizedEndpoint(value: string): string {
  return normalizeSearxngEndpoint(value).toString().replace(/\/$/, "");
}

function runtimePlatformKey(): SearxngRuntimePlatformKey {
  const value = `${process.platform}-${process.arch}`;
  switch (value) {
    case "linux-x64": return "linux-x64";
    case "linux-arm64": return "linux-arm64";
    case "win32-x64": return "win32-x64";
    case "win32-arm64": return "win32-arm64";
    case "darwin-x64": return "darwin-x64";
    case "darwin-arm64": return "darwin-arm64";
    default: throw new Error(`Embedded SearXNG is not supported on ${value}`);
  }
}

function safeRuntimePlatformKey(): string {
  try {return runtimePlatformKey();} catch {return `${process.platform}-${process.arch}`;}
}

async function readInstalledRuntimeMetadata(metadataPath: string): Promise<InstalledRuntimeMetadata | undefined> {
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<InstalledRuntimeMetadata>;
    if (
      parsed.runtime_version !== SEARXNG_RUNTIME_VERSION ||
      typeof parsed.platform_key !== "string" ||
      typeof parsed.asset_name !== "string" ||
      typeof parsed.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(parsed.sha256) ||
      !Number.isSafeInteger(parsed.size) || Number(parsed.size) < 1
    ) {return undefined;}
    return parsed as InstalledRuntimeMetadata;
  } catch {return undefined;}
}

async function verifyInstalledRuntime(
  executable: string,
  metadata: InstalledRuntimeMetadata,
  platformKey: SearxngRuntimePlatformKey,
): Promise<boolean> {
  if (
    metadata.platform_key !== platformKey ||
    metadata.asset_name !== expectedSearxngRuntimeAssetName(platformKey) ||
    metadata.size > MAX_SEARXNG_RUNTIME_BYTES
  ) {return false;}
  try {
    const fileStat = await stat(executable);
    if (fileStat.size !== metadata.size) {return false;}
    return await sha256File(executable) === metadata.sha256.toLowerCase();
  } catch {return false;}
}

async function downloadRuntimeManifest(): Promise<ReturnType<typeof parseSearxngRuntimeManifest>> {
  const response = await fetchWithTimeout(`${SEARXNG_RUNTIME_RELEASE_BASE_URL}/manifest.json`, MANIFEST_TIMEOUT_MS);
  if (!response.ok) {throw new Error(`Unable to download SearXNG runtime manifest (HTTP ${response.status})`);}
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) {throw new Error("SearXNG runtime manifest is unexpectedly large");}
  let parsed: unknown;
  try {parsed = JSON.parse(text);} catch {throw new Error("SearXNG runtime manifest is invalid JSON");}
  return parseSearxngRuntimeManifest(parsed);
}

async function downloadRuntimeAsset(asset: SearxngRuntimeAsset): Promise<Uint8Array> {
  const response = await fetchWithTimeout(`${SEARXNG_RUNTIME_RELEASE_BASE_URL}/${asset.name}`, RUNTIME_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) {throw new Error(`Unable to download ${asset.name} (HTTP ${response.status})`);}
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_SEARXNG_RUNTIME_BYTES) {throw new Error("SearXNG runtime download exceeds the size limit");}
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== asset.size) {
    throw new Error(`SearXNG runtime size mismatch: expected ${asset.size}, received ${bytes.byteLength}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256.toLowerCase()) {throw new Error("SearXNG runtime checksum verification failed");}
  return bytes;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { accept: "application/octet-stream, application/json", "user-agent": "deepseek-agent-searxng-runtime" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (controller.signal.aborted) {throw new Error("SearXNG runtime download timed out");}
    throw error;
  } finally {clearTimeout(timer);}
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensureExecutable(executable: string): Promise<void> {
  await access(executable, fsConstants.R_OK);
  if (process.platform === "win32") {return;}
  await chmod(executable, 0o755);
  await access(executable, fsConstants.X_OK);
}

async function waitUntilReady(endpoint: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    if (child.exitCode !== null) {throw new Error(`Local SearXNG exited before becoming ready (code ${child.exitCode})`);}
    if (await isSearxngAvailable(endpoint)) {return;}
    await delay(READY_INTERVAL_MS);
  }
  throw new Error(`Local SearXNG did not become ready at ${endpoint}`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {return;}
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await Promise.race([exited, delay(PROCESS_STOP_TIMEOUT_MS)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(1_000)]);
  }
}

async function isSearxngAvailable(endpoint: string): Promise<boolean> {
  const base = normalizeSearxngEndpoint(endpoint);
  base.pathname = `${base.pathname}/config`.replace(/^\/\//, "/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(base, { headers: { accept: "application/json" }, redirect: "error", signal: controller.signal });
    if (!response.ok) {return false;}
    const config = await response.json() as unknown;
    return !!config && typeof config === "object" && typeof (config as { instance_name?: unknown }).instance_name === "string";
  } catch {return false;}
  finally {clearTimeout(timer);}
}

function createSettings(port: number): string {
  return `use_default_settings: true\n\ngeneral:\n  debug: false\n  instance_name: "YCraSy DeepSeek Agent Search"\n  enable_metrics: false\n\nsearch:\n  safe_search: 0\n  autocomplete: ""\n  formats:\n    - json\n\nserver:\n  bind_address: "127.0.0.1"\n  port: ${port}\n  secret_key: "${randomBytes(32).toString("hex")}"\n  limiter: false\n  public_instance: false\n  image_proxy: false\n\noutgoing:\n  request_timeout: 4.0\n  max_request_timeout: 8.0\n`;
}

function formatBytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

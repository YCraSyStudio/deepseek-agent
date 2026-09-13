import { isRecord } from "@/shared/utils/TypeGuards";

export const SEARXNG_RUNTIME_VERSION = "2026.08.22-9fea41204-v2";
export const SEARXNG_RUNTIME_COMMIT = "9fea41204fdfa7a5cfa15b0ebd12904c520478ce";
export const SEARXNG_RUNTIME_RELEASE_TAG = `searxng-runtime-${SEARXNG_RUNTIME_VERSION}`;
export const SEARXNG_RUNTIME_RELEASE_BASE_URL = `https://github.com/YCraSyStudio/deepseek-agent/releases/download/${SEARXNG_RUNTIME_RELEASE_TAG}`;
export const MAX_SEARXNG_RUNTIME_BYTES = 512 * 1024 * 1024;

export type SearxngRuntimePlatformKey =
  | "linux-x64"
  | "linux-arm64"
  | "win32-x64"
  | "win32-arm64"
  | "darwin-x64"
  | "darwin-arm64";

export interface SearxngRuntimeAsset {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
}

export interface SearxngRuntimeManifest {
  readonly runtime_version: string;
  readonly searxng_commit: string;
  readonly assets: Partial<Record<SearxngRuntimePlatformKey, SearxngRuntimeAsset>>;
}

export const PINNED_SEARXNG_RUNTIME_ASSETS: Readonly<Partial<Record<SearxngRuntimePlatformKey, SearxngRuntimeAsset>>> = Object.freeze({
  "linux-x64": Object.freeze({
    name: "searxng-runtime-linux-x64",
    sha256: "a424e312f7c6be591819ae68bb7b3178e5f6edaf47c992488a36524e0645f788",
    size: 57_384_640,
  }),
  "linux-arm64": Object.freeze({
    name: "searxng-runtime-linux-arm64",
    sha256: "c29609495aa36ed5b0ba820217b7e7a92f7bbb68980242588b1e067343fc2f0c",
    size: 56_074_744,
  }),
  "win32-x64": Object.freeze({
    name: "searxng-runtime-win32-x64.exe",
    sha256: "a40217fb31552d9ee182cabf321e816e4fc5c5915febbead2cdac1de64fb6db4",
    size: 39_825_631,
  }),
  "darwin-x64": Object.freeze({
    name: "searxng-runtime-darwin-x64",
    sha256: "5b30cc7608504df4fe043b4a9bb9861f34ef7c06103f3620fe075f8d951753f4",
    size: 40_356_496,
  }),
  "darwin-arm64": Object.freeze({
    name: "searxng-runtime-darwin-arm64",
    sha256: "c63b441730024bf371f2e1f92495eb008eb6fb46fdbb7fb0cf102e854ff6f911",
    size: 39_471_456,
  }),
});

const PLATFORM_KEYS = new Set<SearxngRuntimePlatformKey>([
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
  "darwin-x64",
  "darwin-arm64",
]);

export function expectedSearxngRuntimeAssetName(platformKey: SearxngRuntimePlatformKey): string {
  return `searxng-runtime-${platformKey}${platformKey.startsWith("win32-") ? ".exe" : ""}`;
}

export function resolvePinnedSearxngRuntimeAsset(platformKey: SearxngRuntimePlatformKey): SearxngRuntimeAsset {
  const asset = PINNED_SEARXNG_RUNTIME_ASSETS[platformKey];
  if (!asset) {
    throw new Error(`No pinned SearXNG runtime is published for ${platformKey}`);
  }
  return asset;
}

export function parseSearxngRuntimeManifest(value: unknown): SearxngRuntimeManifest {
  if (!isRecord(value)) {throw new Error("SearXNG runtime manifest must be an object");}
  if (value.runtime_version !== SEARXNG_RUNTIME_VERSION) {
    throw new Error(`Unexpected SearXNG runtime version: ${String(value.runtime_version ?? "missing")}`);
  }
  if (value.searxng_commit !== SEARXNG_RUNTIME_COMMIT) {
    throw new Error(`Unexpected SearXNG source revision: ${String(value.searxng_commit ?? "missing")}`);
  }
  if (!isRecord(value.assets)) {throw new Error("SearXNG runtime manifest is missing assets");}

  const assets: Partial<Record<SearxngRuntimePlatformKey, SearxngRuntimeAsset>> = {};
  for (const [key, rawAsset] of Object.entries(value.assets)) {
    if (!PLATFORM_KEYS.has(key as SearxngRuntimePlatformKey)) {
      throw new Error(`Unsupported SearXNG runtime platform in manifest: ${key}`);
    }
    const platformKey = key as SearxngRuntimePlatformKey;
    assets[platformKey] = parseAsset(platformKey, rawAsset);
  }
  return {
    runtime_version: SEARXNG_RUNTIME_VERSION,
    searxng_commit: SEARXNG_RUNTIME_COMMIT,
    assets,
  };
}

export function resolveSearxngRuntimeAsset(
  manifest: SearxngRuntimeManifest,
  platformKey: SearxngRuntimePlatformKey,
): SearxngRuntimeAsset {
  const asset = manifest.assets[platformKey];
  if (!asset) {
    throw new Error(`No SearXNG runtime is published for ${platformKey}`);
  }
  const pinned = resolvePinnedSearxngRuntimeAsset(platformKey);
  if (asset.name !== pinned.name || asset.sha256 !== pinned.sha256 || asset.size !== pinned.size) {
    throw new Error(`Published SearXNG runtime metadata does not match the pinned ${platformKey} asset`);
  }
  return pinned;
}

function parseAsset(platformKey: SearxngRuntimePlatformKey, value: unknown): SearxngRuntimeAsset {
  if (!isRecord(value)) {throw new Error(`Invalid SearXNG runtime asset for ${platformKey}`);}
  const expectedName = expectedSearxngRuntimeAssetName(platformKey);
  if (value.name !== expectedName) {
    throw new Error(`Unexpected SearXNG runtime asset name for ${platformKey}: ${String(value.name ?? "missing")}`);
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
    throw new Error(`Invalid SearXNG runtime checksum for ${platformKey}`);
  }
  if (!Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > MAX_SEARXNG_RUNTIME_BYTES) {
    throw new Error(`Invalid SearXNG runtime size for ${platformKey}`);
  }
  return { name: expectedName, sha256: value.sha256.toLowerCase(), size: Number(value.size) };
}


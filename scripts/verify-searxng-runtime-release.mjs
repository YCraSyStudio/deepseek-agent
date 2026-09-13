import { readFile } from "node:fs/promises";

const sourcePath = new URL("../src/infrastructure/browser/SearxngRuntimeManifest.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const runtimeVersion = requiredMatch(source, /SEARXNG_RUNTIME_VERSION = "([^"]+)"/, "runtime version");
const searxngCommit = requiredMatch(source, /SEARXNG_RUNTIME_COMMIT = "([a-f0-9]{40})"/, "SearXNG commit");
const releaseTag = `searxng-runtime-${runtimeVersion}`;
const releaseBaseUrl = `https://github.com/YCraSyStudio/deepseek-agent/releases/download/${releaseTag}`;
const pinnedAssets = parsePinnedAssets(source);

const manifestResponse = await fetchWithTimeout(`${releaseBaseUrl}/manifest.json`, {
  headers: { accept: "application/json", "user-agent": "deepseek-agent-release-gate" },
  redirect: "follow",
});
if (!manifestResponse.ok) {
  throw new Error(`Pinned SearXNG runtime manifest is unavailable (HTTP ${manifestResponse.status}): ${releaseTag}`);
}
const manifestText = await manifestResponse.text();
if (Buffer.byteLength(manifestText, "utf8") > 256 * 1024) {
  throw new Error("Pinned SearXNG runtime manifest exceeds 256 KiB");
}

let manifest;
try {manifest = JSON.parse(manifestText);} catch {throw new Error("Pinned SearXNG runtime manifest is invalid JSON");}
if (manifest?.runtime_version !== runtimeVersion || manifest?.searxng_commit !== searxngCommit) {
  throw new Error("Pinned SearXNG runtime manifest does not match the extension version and source commit");
}

for (const [platformKey, pinned] of Object.entries(pinnedAssets)) {
  const published = manifest.assets?.[platformKey];
  if (
    published?.name !== pinned.name ||
    published?.sha256 !== pinned.sha256 ||
    published?.size !== pinned.size
  ) {
    throw new Error(`Published SearXNG metadata does not match the pinned ${platformKey} asset`);
  }
  const assetResponse = await fetchWithTimeout(`${releaseBaseUrl}/${pinned.name}`, {
    headers: { "user-agent": "deepseek-agent-release-gate" },
    method: "HEAD",
    redirect: "follow",
  });
  if (!assetResponse.ok) {
    throw new Error(`Pinned SearXNG runtime asset is unavailable for ${platformKey} (HTTP ${assetResponse.status})`);
  }
  const declaredSize = Number(assetResponse.headers.get("content-length"));
  if (Number.isSafeInteger(declaredSize) && declaredSize > 0 && declaredSize !== pinned.size) {
    throw new Error(`Pinned SearXNG runtime asset size changed for ${platformKey}`);
  }
}

console.log(`Verified ${releaseTag}: manifest and ${Object.keys(pinnedAssets).length} pinned assets are available.`);

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {return await fetch(url, { ...init, signal: controller.signal });}
  finally {clearTimeout(timer);}
}

function requiredMatch(text, pattern, label) {
  const value = pattern.exec(text)?.[1];
  if (!value) {throw new Error(`Unable to read ${label} from SearxngRuntimeManifest.ts`);}
  return value;
}

function parsePinnedAssets(text) {
  const assets = {};
  const pattern = /"((?:linux|win32|darwin)-(?:x64|arm64))": Object\.freeze\(\{\s*name: "([^"]+)",\s*sha256: "([a-f0-9]{64})",\s*size: ([\d_]+),\s*\}\)/g;
  for (const match of text.matchAll(pattern)) {
    assets[match[1]] = { name: match[2], sha256: match[3], size: Number(match[4].replaceAll("_", "")) };
  }
  if (Object.keys(assets).length === 0) {throw new Error("Unable to read pinned assets from SearxngRuntimeManifest.ts");}
  return assets;
}

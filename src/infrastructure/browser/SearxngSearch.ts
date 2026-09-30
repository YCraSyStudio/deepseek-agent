import type { SearchDiagnostics, SearchAttemptDiagnostics } from "@/contracts/SearchDiagnostics";
import { redactSensitiveText } from "@/shared/security/Redaction";
import { createHash } from "node:crypto";
import { validatePublicWebUrl } from "./NetworkPolicy";
import type { SearchLocale } from "./SearchProviders";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
let fallbackEngineShortcuts: () => readonly string[] = () => [];
const recentDiagnostics = new Map<string, SearchDiagnostics>();

export function getSearxngSearchDiagnostics(endpoint: string): SearchDiagnostics | undefined {
  const value = recentDiagnostics.get(normalizeSearxngEndpoint(endpoint).toString());
  return value && Date.now() - value.observedAt < 5 * 60_000 ? value : undefined;
}

export class SearxngSearchError extends Error {
  constructor(message: string, readonly diagnostics: SearchDiagnostics) {super(message);}
}

let selectedEngineShortcuts: () => readonly string[] = () => [];

export interface SearxngSearchResult {
  urls: string[];
  contentHash: string;
  provenance: Array<{ url: string; engines: string[] }>;
  diagnostics: SearchDiagnostics;
}

export interface SearxngEngineInfo {
  name: string;
  shortcut: string;
  categories: string[];
  enabled: boolean;
}

export function configureSearxngEngineSelection(provider: () => readonly string[], fallback: () => readonly string[] = () => []): void {
  selectedEngineShortcuts = provider;
  fallbackEngineShortcuts = fallback;
}

export function normalizeSearxngEndpoint(value: string): URL {
  let url: URL;
  try {url = new URL(value.trim());}
  catch {throw new Error("SearXNG endpoint must be a valid URL");}
  if (url.username || url.password) {throw new Error("SearXNG endpoint must not contain credentials");}
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("SearXNG endpoint must use HTTPS, except for localhost/loopback HTTP");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export async function fetchSearxngEngines(
  endpoint: string,
  signal?: AbortSignal,
): Promise<SearxngEngineInfo[]> {
  const url = normalizeSearxngEndpoint(endpoint);
  url.pathname = `${url.pathname}/config`.replace(/^\/\//, "/");
  const body = await fetchBoundedText(url, signal);
  let parsed: unknown;
  try {parsed = JSON.parse(body) as unknown;}
  catch {throw new Error("SearXNG /config returned invalid JSON");}
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { engines?: unknown }).engines)) {
    throw new Error("SearXNG /config returned an unexpected response shape");
  }
  const engines: SearxngEngineInfo[] = [];
  const seen = new Set<string>();
  for (const value of (parsed as { engines: unknown[] }).engines) {
    if (!value || typeof value !== "object") {continue;}
    const candidate = value as { name?: unknown; shortcut?: unknown; categories?: unknown; enabled?: unknown };
    if (typeof candidate.name !== "string" || typeof candidate.shortcut !== "string") {continue;}
    const shortcut = candidate.shortcut.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(shortcut) || seen.has(shortcut)) {continue;}
    seen.add(shortcut);
    engines.push({
      name: candidate.name.trim() || shortcut,
      shortcut,
      categories: Array.isArray(candidate.categories)
        ? candidate.categories.filter((item): item is string => typeof item === "string").slice(0, 16)
        : [],
      enabled: candidate.enabled === true,
    });
  }
  engines.sort((left, right) => left.name.localeCompare(right.name));
  return engines;
}

export async function searchSearxng(
  endpoint: string,
  query: string,
  locale: SearchLocale,
  limit: number,
  enginesOrSignal?: readonly string[] | AbortSignal,
  maybeSignal?: AbortSignal,
): Promise<SearxngSearchResult> {
  const selectionProvided = isEngineSelection(enginesOrSignal);
  const explicitEngines = selectionProvided ? enginesOrSignal : undefined;
  const signal: AbortSignal | undefined = selectionProvided ? maybeSignal : enginesOrSignal;
  const selected = normalizeEngineShortcuts(explicitEngines ?? selectedEngineShortcuts());
  const fallback = normalizeEngineShortcuts(fallbackEngineShortcuts());
  const attempts: SearchAttemptDiagnostics[] = [];
  const budget = AbortSignal.timeout(16_000);
  const combinedSignal = signal ? AbortSignal.any([signal, budget]) : budget;
  for (let attempt = 0; attempt < 2; attempt++) {
    const engines = attempt === 0 ? selected : fallback;
    const started = Date.now();
    const diagnostics: SearchAttemptDiagnostics = {
      selectedEngines: engines, contributingEngines: [], unavailableEngines: [], metadataPresent: false,
      rawResults: 0, filteredResults: 0, elapsedMs: 0, status: "network_error",
    };
    attempts.push(diagnostics);
    let body = "";
    const provenance: SearxngSearchResult["provenance"] = [];
    try {
      const url = normalizeSearxngEndpoint(endpoint);
      url.pathname = `${url.pathname}/search`.replace(/^\/\//, "/");
      url.searchParams.set("q", engines.length ? `${engines.map((shortcut) => `!${shortcut}`).join(" ")} ${query}` : query);
      url.searchParams.set("format", "json");
      url.searchParams.set("language", locale.tag);
      body = await fetchBoundedText(url, combinedSignal);
      const parsed = parseResponse(body);
      diagnostics.rawResults = parsed.results.length;
      diagnostics.metadataPresent = parsed.metadataPresent;
      diagnostics.unavailableEngines = parsed.unavailableEngines;
      const seen = new Set<string>();
      for (const result of parsed.results.slice(0, 1000)) {
        if (!result || typeof result !== "object") {diagnostics.filteredResults++; continue;}
        const candidate = result as { url?: unknown; engines?: unknown };
        if (typeof candidate.url !== "string") {diagnostics.filteredResults++; continue;}
        try {
          const normalized = validatePublicWebUrl(candidate.url).toString();
          if (seen.has(normalized)) {continue;}
          seen.add(normalized);
          const contributing = Array.isArray(candidate.engines) ? candidate.engines.filter((value): value is string => typeof value === "string").slice(0, 16).map((value) => value.slice(0, 128)) : [];
          provenance.push({ url: normalized, engines: contributing });
        } catch {diagnostics.filteredResults++; continue;}
        if (seen.size >= limit) {break;}
      }
      diagnostics.contributingEngines = [...new Set(provenance.flatMap((item) => item.engines))].slice(0, 32);
      diagnostics.status = provenance.length > 0 ? "success" : parsed.unavailableEngines.length > 0
        ? "engines_unavailable" : parsed.results.length > 0 ? "filtered_urls" : "empty_results";
    } catch (error) {
      if (signal?.aborted) {throw error;}
      diagnostics.status = combinedSignal.aborted || /timeout|timed out/i.test(String(error)) ? "timeout" : "network_error";
    }
    diagnostics.elapsedMs = Date.now() - started;
    const last = diagnostics;
    const summary: SearchDiagnostics = {
      observedAt: Date.now(), attempts: structuredClone(attempts),
      singleEngine: last.contributingEngines.length === 1,
      availability: last.status === "success"
        ? (!last.metadataPresent || !last.contributingEngines.length ? "unknown" : last.unavailableEngines.length || last.contributingEngines.length === 1 ? "degraded" : "healthy")
        : last.status === "empty_results" ? (last.metadataPresent ? "healthy" : "unknown") : "unavailable",
    };
    const key = normalizeSearxngEndpoint(endpoint).toString();
    recentDiagnostics.delete(key); recentDiagnostics.set(key, summary);
    if (recentDiagnostics.size > 16) {recentDiagnostics.delete(recentDiagnostics.keys().next().value!);}
    if (last.status === "success" || last.status === "empty_results") {
      return { urls: provenance.map((item) => item.url), provenance, diagnostics: summary,
        contentHash: createHash("sha256").update(body, "utf8").digest("hex") };
    }
    if (attempt === 0 && last.status === "engines_unavailable" && fallback.length && JSON.stringify(selected) !== JSON.stringify(fallback) && !combinedSignal.aborted) {continue;}
    throw new SearxngSearchError(`SearXNG search failed: ${last.status}`, summary);
  }
  throw new Error("SearXNG search budget exhausted");
}

async function fetchBoundedText(url: URL, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("SearXNG request timed out")), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {abort();}

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {throw new Error(`SearXNG returned HTTP ${response.status}`);}
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("SearXNG response exceeded the maximum allowed size");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("SearXNG response exceeded the maximum allowed size");
    }
    return body;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function isEngineSelection(value: readonly string[] | AbortSignal | undefined): value is readonly string[] {
  return Array.isArray(value);
}

function normalizeEngineShortcuts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const shortcut = value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(shortcut)) {continue;}
    seen.add(shortcut);
    if (seen.size >= 512) {break;}
  }
  return [...seen];
}

function parseResponse(body: string): { results: unknown[]; metadataPresent: boolean; unavailableEngines: Array<{ engine: string; reason: string }> } {
  let parsed: unknown;
  try {parsed = JSON.parse(body) as unknown;}
  catch {throw new Error("SearXNG returned invalid JSON");}
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { results?: unknown }).results)) {
    throw new Error("SearXNG returned an unexpected response shape");
  }
  const record = parsed as { results: unknown[]; unresponsive_engines?: unknown };
  const unavailableEngines = Array.isArray(record.unresponsive_engines)
    ? record.unresponsive_engines.slice(0, 32).flatMap((value) => Array.isArray(value) && typeof value[0] === "string"
      ? [{ engine: value[0].slice(0, 128), reason: redactSensitiveText(String(value[1] ?? "Unavailable")).slice(0, 160) }] : []) : [];
  return { results: record.results, metadataPresent: Array.isArray(record.unresponsive_engines), unavailableEngines };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

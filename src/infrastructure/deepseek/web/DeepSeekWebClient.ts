import { createHash } from "node:crypto";
import { deepseekFetch } from "../client/DeepSeekFetch";
import { MAX_METADATA_RESPONSE_BYTES, readBoundedJson } from "../client/BoundedResponseJson";
import { validatePublicWebUrl } from "@/infrastructure/browser/NetworkPolicy";
import { validateResultLimit, validateSearchQuery } from "@/infrastructure/browser/Validation";
import { normalizeApiBaseUrl } from "@/shared/security/ApiOrigin";
import { isRecord } from "@/shared/utils/TypeGuards";

interface WebSearchItem {
  url: string;
  title: string;
  summary: string;
}

export interface DeepSeekSearchResult {
  urls: string[];
  results: WebSearchItem[];
  contentHash: string;
}

interface WebCredentials { baseUrl: string; apiKey: string }
const REQUEST_TIMEOUT_MS = 30_000;

/** Standalone Search/Fetch APIs; model chat and tool execution share no transcript here. */
export class DeepSeekWebClient {
  private readonly shutdown = new AbortController();
  private active = 0;
  private completed = 0;
  private failed = 0;

  constructor(private readonly credentials: () => Promise<WebCredentials>) {}

  async search(query: string, limit: number, signal?: AbortSignal): Promise<DeepSeekSearchResult> {
    const value = await this.request("search", {
      query: validateSearchQuery(query), count: validateResultLimit(limit), need_content: false,
    }, signal);
    if (!isRecord(value) || !Array.isArray(value.results)) {throw new Error("DeepSeek returned an invalid search response.");}
    const results: WebSearchItem[] = [];
    const seen = new Set<string>();
    for (const item of value.results) {
      if (!isRecord(item) || typeof item.url !== "string") {continue;}
      let url: string;
      try {url = validatePublicWebUrl(item.url).toString();} catch {continue;}
      if (seen.has(url)) {continue;}
      seen.add(url);
      results.push({
        url,
        title: typeof item.title === "string" ? item.title.slice(0, 256) : "",
        summary: typeof item.summary === "string" ? item.summary.slice(0, 1_200)
          : typeof item.snippet === "string" ? item.snippet.slice(0, 1_200) : "",
      });
      if (results.length >= limit) {break;}
    }
    return {
      urls: results.map((item) => item.url), results,
      contentHash: createHash("sha256").update(JSON.stringify(results)).digest("hex"),
    };
  }

  async fetchPage(url: string, signal?: AbortSignal): Promise<{ title: string; content: string }> {
    const value = await this.request("fetch", { url: validatePublicWebUrl(url).toString() }, signal);
    if (!isRecord(value) || typeof value.content !== "string" || value.content.trim().length === 0 ||
      (value.title !== undefined && typeof value.title !== "string")) {
      throw new Error("DeepSeek returned an invalid or empty page response.");
    }
    return { title: typeof value.title === "string" ? value.title.slice(0, 512) : "", content: value.content };
  }

  getDiagnostics(): Record<string, unknown> {
    return { source: "deepseek-search-fetch-api", available: !this.shutdown.signal.aborted,
      active: this.active, completed: this.completed, failed: this.failed };
  }

  dispose(): void {this.shutdown.abort(new DOMException("Web tools disposed", "AbortError"));}

  private async request(operation: "search" | "fetch", body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const credentials = await this.credentials();
    combined.throwIfAborted();
    if (!credentials.apiKey.trim()) {throw new Error("No API key is configured for web search at this API origin.");}
    // Search/Fetch always live under /v1, including when chat uses the /beta base URL.
    const base = new URL(normalizeApiBaseUrl(credentials.baseUrl));
    base.pathname = `${base.pathname.replace(/\/$/, "").replace(/\/(?:v1|beta)$/, "")}/v1`;
    this.active++;
    try {
      const response = await deepseekFetch({
        baseUrl: base.toString(), pathOrUrl: `tools/${operation}`, apiKey: credentials.apiKey,
        requestInit: { method: "POST", body: JSON.stringify(body), signal: combined },
      });
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        await response.body?.cancel();
        throw new Error("DeepSeek web API did not return JSON.");
      }
      const value = await readBoundedJson(response, MAX_METADATA_RESPONSE_BYTES).catch((error: unknown) => {
        if (error instanceof SyntaxError) {throw new Error("DeepSeek web API returned invalid JSON.");}
        throw error;
      });
      this.completed++;
      return value;
    } catch (error) {
      this.failed++;
      throw error;
    } finally {this.active--;}
  }
}

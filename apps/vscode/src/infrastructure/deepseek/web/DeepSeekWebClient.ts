import { createHash } from "node:crypto";
import { deepseekFetch } from "../client/DeepSeekFetch";
import { MAX_METADATA_RESPONSE_BYTES, readBoundedJson } from "../client/BoundedResponseJson";
import { validatePublicWebUrl } from "@/infrastructure/browser/NetworkPolicy";
import { validateResultLimit, validateSearchQuery } from "@/infrastructure/browser/Validation";
import { normalizeApiBaseUrl } from "@/shared/security/ApiOrigin";
import { isRecord } from "@/shared/utils/TypeGuards";
import type { WebSearchOptions, WebSearchPage } from "@/infrastructure/browser/Types";

export interface DeepSeekSearchResult {
  urls: string[];
  results: WebSearchPage[];
  contentHash: string;
}

interface WebCredentials { baseUrl: string; apiKey: string }
const REQUEST_TIMEOUT_MS = 30_000;

/** Standalone Search APIs; model chat and tool execution share no transcript here. */
export class DeepSeekWebClient {
  private readonly shutdown = new AbortController();
  private active = 0;
  private completed = 0;
  private failed = 0;

  constructor(private readonly credentials: () => Promise<WebCredentials>) {}

  async search(query: string, limit: number, signal?: AbortSignal, options: WebSearchOptions = {}): Promise<DeepSeekSearchResult> {
    const originalQuestion = Array.from(options.originalQuestion?.trim() || query);
    const preference = options.region && options.region !== "global" ? `Prefer sources relevant to ${options.region}. ` : "";
    const value = await this.request({
      query: validateSearchQuery(query), count: validateResultLimit(limit), need_content: options.needContent ?? true,
      ori_question: preference + originalQuestion.slice(0, 128 - Array.from(preference).length).join(""),
    }, signal);
    if (!isRecord(value) || !Array.isArray(value.results)) {throw new Error("DeepSeek returned an invalid search response.");}
    const results: WebSearchPage[] = [];
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
        ...(typeof item.content === "string" && item.content.trim() ? { content: item.content.slice(0, 64 * 1024) } : {}),
        ...(typeof item.rerank_score === "number" && Number.isFinite(item.rerank_score) && item.rerank_score >= 0 && item.rerank_score <= 3 ? { rerank_score: item.rerank_score } : {}),
        ...(Number.isInteger(item.authority) && (item.authority as number) >= -1 && (item.authority as number) <= 4 ? { authority: item.authority as number } : {}),
        ...(typeof item.date === "string" && item.date.length <= 40 && Number.isFinite(Date.parse(item.date)) ? { date: item.date } : {}),
        ...(typeof item.site_name === "string" ? { site_name: item.site_name.slice(0, 128) } : {}),
      });
      if (results.length >= limit) {break;}
    }
    return {
      urls: results.map((item) => item.url), results,
      contentHash: createHash("sha256").update(JSON.stringify(results)).digest("hex"),
    };
  }

  getDiagnostics(): Record<string, unknown> {
    return { source: "deepseek-search-api", available: !this.shutdown.signal.aborted,
      active: this.active, completed: this.completed, failed: this.failed };
  }

  dispose(): void {this.shutdown.abort(new DOMException("Web tools disposed", "AbortError"));}

  private async request(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const credentials = await this.credentials();
    combined.throwIfAborted();
    if (!credentials.apiKey.trim()) {throw new Error("No API key is configured for web search at this API origin.");}
    // Search always live under /v1, including when chat uses the /beta base URL.
    const base = new URL(normalizeApiBaseUrl(credentials.baseUrl));
    base.pathname = `${base.pathname.replace(/\/$/, "").replace(/\/(?:v1|beta)$/, "")}/v1`;
    this.active++;
    try {
      const response = await deepseekFetch({
        baseUrl: base.toString(), pathOrUrl: "tools/search", apiKey: credentials.apiKey,
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

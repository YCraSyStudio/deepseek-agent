import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import * as https from "node:https";
import { resolvePublicHostname, type WebAccessPolicy } from "./NetworkPolicy";
import { createAbortError, throwIfAborted } from "@/shared/utils/Cancellation";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_CONCURRENT_READS = 4;
const MAX_WAITING_OPERATIONS = 32;
const USER_AGENT = "YCraSy-DeepSeek-Agent/0.1";
const TEXTUAL_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
] as const;

interface RenderedLink {
  title: string;
  url: string;
  snippet?: string;
  sponsored?: boolean;
}

export interface RenderedPage {
  title: string;
  url: string;
  content: string;
  sections?: string[];
  outline: string[];
  links: RenderedLink[];
  contentHash: string;
  injectionRisk: "none" | "suspected";
}

interface HttpResponsePayload {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export class HeadlessWebRuntime {
  private active = 0;
  private waiting: Array<{ ready: () => void; reject: (error: Error) => void }> = [];
  private disposed = false;
  private completed = 0;
  private failed = 0;
  private requests = 0;
  private transferredBytes = 0;

  async render(
    url: string,
    policy: WebAccessPolicy,
    signal?: AbortSignal,
    _settleMs?: number,
  ): Promise<RenderedPage> {
    return this.withSlot(async () => {
      try {
        const page = await this.read(url, policy, signal);
        this.completed += 1;
        return page;
      } catch (error) {
        this.failed += 1;
        throw error;
      }
    }, signal);
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      source: "builtin-http-reader",
      available: !this.disposed,
      active: this.active,
      waiting: this.waiting.length,
      completed: this.completed,
      failed: this.failed,
      requests: this.requests,
      transferredBytes: this.transferredBytes,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const waiting = this.waiting.splice(0);
    for (const entry of waiting) {
      entry.reject(new Error("Web runtime is shutting down"));
    }
  }

  private async read(url: string, policy: WebAccessPolicy, signal?: AbortSignal): Promise<RenderedPage> {
    throwIfAborted(signal, "Web operation cancelled");
    let current = policy.assertNavigationAllowed(url);
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await this.requestPinned(current, signal);
      if (isRedirect(response.status)) {
        const location = response.headers.location;
        if (!location) {throw new Error(`Web server returned HTTP ${response.status} without a redirect location`);}
        if (redirectCount >= MAX_REDIRECTS) {throw new Error("Web page exceeded the redirect limit");}
        current = policy.assertNavigationAllowed(new URL(location, current).toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Web page returned HTTP ${response.status}`);
      }
      return parseResponse(current, response);
    }
    throw new Error("Web page exceeded the redirect limit");
  }

  private async requestPinned(url: URL, signal?: AbortSignal): Promise<HttpResponsePayload> {
    throwIfAborted(signal, "Web operation cancelled");
    const addresses = await resolvePublicHostname(url.hostname);
    let lastError: unknown;
    for (const address of addresses.slice(0, 6)) {
      try {
        return await this.requestAddress(url, address.address, signal);
      } catch (error) {
        if (signal?.aborted) {throw error;}
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Unable to connect to the public web host");
  }

  private requestAddress(url: URL, address: string, signal?: AbortSignal): Promise<HttpResponsePayload> {
    return new Promise((resolve, reject) => {
      throwIfAborted(signal, "Web operation cancelled");
      let settled = false;
      const finishReject = (error: Error): void => {
        if (settled) {return;}
        settled = true;
        cleanup();
        reject(error);
      };
      const finishResolve = (value: HttpResponsePayload): void => {
        if (settled) {return;}
        settled = true;
        cleanup();
        resolve(value);
      };
      const request = https.request({
        protocol: "https:",
        hostname: address,
        port: 443,
        servername: url.hostname,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: {
          host: url.hostname,
          accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
          "user-agent": USER_AGENT,
        },
        rejectUnauthorized: true,
      }, (response) => {
        this.requests += 1;
        const declaredLength = Number(response.headers["content-length"] ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
          response.resume();
          finishReject(new Error("Web response exceeded the maximum allowed size"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("Web response exceeded the maximum allowed size"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", (error) => finishReject(error));
        response.once("end", () => {
          this.transferredBytes += bytes;
          finishResolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
        });
      });
      const onAbort = (): void => {
        request.destroy(createAbortError("Web operation cancelled"));
      };
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
      signal?.addEventListener("abort", onAbort, { once: true });
      request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Web request timed out")));
      request.once("error", (error) => finishReject(error));
      request.end();
    });
  }

  private async withSlot<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.disposed) {throw new Error("Web runtime is unavailable");}
    throwIfAborted(signal, "Web operation cancelled");
    if (this.active >= MAX_CONCURRENT_READS) {
      if (this.waiting.length >= MAX_WAITING_OPERATIONS) {
        throw new Error("Web runtime concurrency limit reached");
      }
      await new Promise<void>((resolve, reject) => {
        const entry = { ready: resolve, reject };
        this.waiting.push(entry);
        const onAbort = (): void => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) {this.waiting.splice(index, 1);}
          reject(createAbortError("Web operation cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (this.disposed) {throw new Error("Web runtime is unavailable");}
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.ready();
    }
  }
}

function parseResponse(url: URL, response: HttpResponsePayload): RenderedPage {
  const contentType = String(response.headers["content-type"] ?? "text/plain").toLowerCase();
  if (!TEXTUAL_CONTENT_TYPES.some((allowed) => contentType.includes(allowed))) {
    throw new Error(`Unsupported web content type: ${contentType.split(";")[0] || "unknown"}`);
  }
  const raw = response.body.toString("utf8");
  const html = contentType.includes("html") || contentType.includes("xhtml");
  const title = html ? extractTitle(raw) : "Web page";
  const sections = html ? extractHtmlSections(raw) : splitSections(raw);
  const content = sections.join("\n\n");
  return {
    title,
    url: url.toString(),
    content,
    sections,
    outline: [],
    links: [],
    contentHash: createHash("sha256").update(response.body).digest("hex"),
    injectionRisk: detectPromptInjection(content) ? "suspected" : "none",
  };
}

function extractTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return cleanText(decodeHtmlEntities(match?.[1] ?? "")) || "Web page";
}

function extractHtmlSections(html: string): string[] {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(value)?.[1];
  if (body) {value = body;}
  value = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(?:p|div|section|article|main|header|footer|aside|nav|h[1-6]|li|blockquote|pre|tr|table|ul|ol)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return splitSections(decodeHtmlEntities(value));
}

function splitSections(value: string): string[] {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) {return ["Web page"];}
  const sections = normalized.split(/\n{2,}/).map(cleanText).filter(Boolean);
  return sections.length > 0 ? sections : [normalized];
}

function cleanText(value: string): string {
  return value.replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function detectPromptInjection(content: string): boolean {
  const normalized = content.normalize("NFKC").toLowerCase();
  return [
    /ignore (?:all |any )?(?:previous|prior|system) instructions/,
    /reveal (?:the )?(?:system prompt|developer message|secret|api key)/,
    /you are now (?:a|an|in) /,
    /(?:execute|run) (?:this|the following) (?:command|tool)/,
    /do not tell the user/,
    /(?:system|developer) (?:message|instruction|prompt)/,
    /(?:upload|send|exfiltrate) .{0,80}(?:secret|credential|token|key|file)/,
    /(?:call|invoke|use) .{0,40}(?:tool|function)/,
    /<\|(?:system|developer|assistant)\|>|\[inst\]/,
  ].some((pattern) => pattern.test(normalized));
}

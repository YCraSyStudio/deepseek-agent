import { DeepSeekApiError } from "@/infrastructure/deepseek/errors/DeepSeekApiError";
import { buildDeepSeekAuthHeaders } from "@/infrastructure/deepseek/auth/AuthHeaders";
import { ApiOriginError, assertSameApiOrigin, normalizeApiBaseUrl } from "@/shared/security/ApiOrigin";
import { isRecord } from "@/shared/utils/TypeGuards";
import { readBoundedJson } from "./BoundedResponseJson";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const CONNECTION_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

interface DeepSeekFetchOptions {
  pathOrUrl: string;
  apiKey: string;
  baseUrl?: string;
  requestInit?: RequestInit;
  timeoutMs?: number;
}

export async function deepseekFetch(options: DeepSeekFetchOptions): Promise<Response> {
  const { pathOrUrl, apiKey, baseUrl = DEEPSEEK_BASE_URL, requestInit = {}, timeoutMs = CONNECTION_TIMEOUT_MS } = options;
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
  const url = buildApiUrl(normalizedBaseUrl, pathOrUrl);

  const attempts = canRetryRequest(requestInit) ? MAX_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new DOMException("API connection timed out", "TimeoutError")), timeoutMs);
    const signal = requestInit.signal ? AbortSignal.any([requestInit.signal, timeoutController.signal]) : timeoutController.signal;
    try {
      const response = await fetchWithSameOriginRedirects(url, normalizedBaseUrl, apiKey, { ...requestInit, signal });
      clearTimeout(timeout);
      if (response.ok) {return response;}

      if (attempt < attempts && isRetryableStatus(response.status)) {
        const delay = getRetryDelayMs(response.headers.get("retry-after"), attempt);
        await response.body?.cancel();
        await wait(delay, requestInit.signal);
        continue;
      }
      const errorDescriptor = await readSafeErrorDescriptor(response);
      throw new DeepSeekApiError(
        response.status,
        getSafeHttpErrorMessage(response.status),
        errorDescriptor.code ?? String(response.status),
        errorDescriptor.reason,
      );
    } catch (error) {
      clearTimeout(timeout);
      if (requestInit.signal?.aborted || error instanceof DeepSeekApiError || error instanceof ApiOriginError || attempt === attempts) {throw error;}
      await wait(getRetryDelayMs(null, attempt), requestInit.signal);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("DeepSeek request failed after retries");
}

function canRetryRequest(requestInit: RequestInit): boolean {
  const method = (requestInit.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function buildApiUrl(baseUrl: string, pathOrUrl: string): string {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
  if (/^[a-z][a-z\d+.-]*:/i.test(pathOrUrl)) {
    return assertSameApiOrigin(normalizedBaseUrl, pathOrUrl).toString();
  }
  const url = new URL(pathOrUrl.replace(/^\/+/, ""), `${normalizedBaseUrl}/`);
  return assertSameApiOrigin(normalizedBaseUrl, url.toString()).toString();
}

async function fetchWithSameOriginRedirects(
  initialUrl: string,
  baseUrl: string,
  apiKey: string,
  requestInit: RequestInit,
): Promise<Response> {
  let currentUrl = assertSameApiOrigin(baseUrl, initialUrl);
  let currentInit = { ...requestInit };

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const headers = buildDeepSeekAuthHeaders(apiKey, currentInit.headers || {});
    if (currentInit.body instanceof FormData) {
      headers.delete("Content-Type");
    }
    const response = await fetch(currentUrl, {
      ...currentInit,
      redirect: "manual",
      headers,
    });
    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (redirectCount === MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new ApiOriginError("The API request exceeded the redirect limit.");
    }

    const redirectedUrl = new URL(location, currentUrl);
    await response.body?.cancel();
    currentUrl = assertSameApiOrigin(baseUrl, redirectedUrl.toString());
    currentInit = redirectedRequestInit(currentInit, response.status);
  }
  throw new ApiOriginError("The API request exceeded the redirect limit.");
}

function redirectedRequestInit(requestInit: RequestInit, status: number): RequestInit {
  const method = (requestInit.method ?? "GET").toUpperCase();
  if (status !== 303 && !((status === 301 || status === 302) && method === "POST")) {
    return requestInit;
  }
  const headers = new Headers(requestInit.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  return { ...requestInit, method: "GET", body: undefined, headers };
}

function getSafeHttpErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Invalid API credentials.";
    case 402:
      return "Insufficient API balance.";
    case 403:
      return "API access denied.";
    case 429:
      return "API rate limit exceeded.";
    default:
      return `API request failed with HTTP ${status}.`;
  }
}

interface SafeErrorDescriptor {
  code?: string;
  reason?: "model_unavailable";
}

async function readSafeErrorDescriptor(response: Response): Promise<SafeErrorDescriptor> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("json")) {
    await response.body?.cancel().catch(() => undefined);
    return {};
  }
  try {
    const value = await readBoundedJson(response, MAX_ERROR_RESPONSE_BYTES);
    if (!isRecord(value) || !isRecord(value.error)) {return {};}
    const code = safeIdentifier(value.error.code);
    const type = safeIdentifier(value.error.type);
    const message = typeof value.error.message === "string" && value.error.message.length <= 512
      ? value.error.message.toLowerCase()
      : "";
    const normalized = `${code ?? ""} ${type ?? ""}`.toLowerCase();
    const modelCode = /(?:model_not_found|model_not_available|model_unavailable|unsupported_model|invalid_model)/.test(normalized);
    const modelMessage = /\bmodel\b.{0,80}\b(?:not found|not available|unavailable|unsupported|does not exist|not exist|retired|deprecated)\b/.test(message);
    return {
      ...(code ? { code } : {}),
      ...((modelCode || modelMessage) ? { reason: "model_unavailable" as const } : {}),
    };
  } catch {
    return {};
  }
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function getRetryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {return Math.min(30_000, Math.max(0, seconds * 1_000));}
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) {return Math.min(30_000, Math.max(0, dateDelay));}
  }
  return Math.min(4_000, 500 * 2 ** (attempt - 1));
}

function wait(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));}
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

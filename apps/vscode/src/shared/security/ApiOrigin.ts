const DEFAULT_API_BASE_URL = "https://api.deepseek.com";

export class ApiOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiOriginError";
  }
}

function parseApiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiOriginError("The API base URL is invalid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiOriginError("The API base URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new ApiOriginError("The API base URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new ApiOriginError("The API base URL must not contain a query or fragment.");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new ApiOriginError("HTTPS is required for non-loopback API endpoints.");
  }
  return url;
}

export function normalizeApiBaseUrl(value: string): string {
  const url = parseApiBaseUrl(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function normalizeApiBaseUrlOrDefault(value: unknown, fallback = DEFAULT_API_BASE_URL): string {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return normalizeApiBaseUrl(value);
  } catch {
    return fallback;
  }
}

export function getApiOrigin(value: string): string {
  return parseApiBaseUrl(value).origin;
}

export function isAllowedApiBaseUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    parseApiBaseUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function isLoopbackApiBaseUrl(value: string): boolean {
  try {
    return isLoopbackHostname(parseApiBaseUrl(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  const match = /^(\d{1,3})(?:\.(\d{1,3})){3}$/.exec(normalized);
  if (!match) {
    return false;
  }
  const octets = normalized.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) && octets[0] === 127;
}

export function assertSameApiOrigin(baseUrl: string, candidateUrl: string): URL {
  const base = parseApiBaseUrl(baseUrl);
  const candidate = parseApiRequestUrl(candidateUrl);
  if (candidate.origin !== base.origin) {
    throw new ApiOriginError(`Refusing to send API credentials to a different origin (${candidate.origin}).`);
  }
  return candidate;
}

function parseApiRequestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiOriginError("The API request URL is invalid.");
  }
  if (url.username || url.password) {
    throw new ApiOriginError("API request URLs must not contain credentials.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiOriginError("API request URLs must use HTTPS.");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new ApiOriginError("HTTPS is required for non-loopback API endpoints.");
  }
  return url;
}

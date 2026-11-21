export function buildDeepSeekAuthHeaders(apiKey: string, extraHeaders: HeadersInit = {}): Headers {
  const headers = new Headers(extraHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${apiKey}`);
  return headers;
}

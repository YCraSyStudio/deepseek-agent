import { normalizeApiBaseUrl } from "@/shared/security/ApiOrigin";

export function resolveDeepSeekApiBaseUrl(baseUrl: string, betaEnabled: boolean): string {
  const url = new URL(normalizeApiBaseUrl(baseUrl));
  if (betaEnabled) {
    url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/(?:v1|beta)$/, "")}/beta`;
  } else {
    url.pathname = url.pathname.replace(/\/beta\/?$/, "/v1");
  }
  return url.toString().replace(/\/$/, "");
}

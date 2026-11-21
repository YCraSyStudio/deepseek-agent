let latestNavigationRequestId: string | undefined;
export const NAVIGATION_STARTED_EVENT = "deepseek-agent:navigation-started";

export function beginNavigationRequest(): string {
  latestNavigationRequestId = crypto.randomUUID();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NAVIGATION_STARTED_EVENT));
  }
  return latestNavigationRequestId;
}

export function isLatestNavigationRequest(requestId: string): boolean {
  return latestNavigationRequestId === requestId;
}

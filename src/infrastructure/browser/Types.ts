import type { SearchDiagnostics } from "@/contracts/SearchDiagnostics";
type WebSearchProviderId = "searxng";

export interface WebSecurityMetadata {
  source: "live_web";
  active_content_removed: true;
  injection_risk: "none" | "suspected";
  content_hash: string;
}

export interface WebSearchResult {
  kind: "web_search_results";
  search_id: string;
  provider: WebSearchProviderId;
  urls: string[];
  diagnostics?: SearchDiagnostics;
  provenance?: Array<{ url: string; engines: string[] }>;
  trust: "untrusted_web_content";
  security: WebSecurityMetadata;
}

export interface WebSearchFailure {
  kind: "web_search_failure";
  terminal: true;
  provider: WebSearchProviderId;
  reason: string;
  diagnostics?: SearchDiagnostics;
  trust: "untrusted_web_content";
}

export interface WebContentSection {
  id: number;
  content: string;
}

export interface WebDocumentResult {
  kind: "web_document" | "web_document_fragment";
  document_id: string;
  title: string;
  url: string;
  warning_before: string;
  boundary_open: string;
  sections: WebContentSection[];
  boundary_close: string;
  warning_after: string;
  cursor: string;
  next_cursor?: string;
  trust: "untrusted_web_content";
  security: WebSecurityMetadata;
}

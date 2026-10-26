type WebSearchProviderId = "deepseek";

interface WebSearchItem {
  url: string;
  title: string;
  summary: string;
  rerank_score?: number;
  authority?: number;
  date?: string;
  site_name?: string;
}

export interface WebSearchPage extends WebSearchItem {
  content?: string;
}

export interface WebSearchOptions {
  originalQuestion?: string;
  needContent?: boolean;
  region?: string;
}

export interface WebSecurityMetadata {
  source: "live_web";
  active_content_removed: true;
  injection_risk: "none" | "suspected";
  content_hash: string;
}

export interface WebSearchResult {
  kind: "web_search_results";
  search_id: string;
  warning_before: string;
  warning_after: string;
  provider: WebSearchProviderId;
  urls: string[];
  results?: WebSearchItem[];
  preferences?: { region?: string; language: string; purpose: "software_development" };
  trust: "untrusted_web_content";
  security: WebSecurityMetadata;
}

export interface WebSearchFailure {
  kind: "web_search_failure";
  terminal: true;
  provider: WebSearchProviderId;
  reason: string;
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

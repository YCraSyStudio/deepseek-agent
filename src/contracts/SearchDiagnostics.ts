export interface SearchAttemptDiagnostics {
  selectedEngines: string[];
  contributingEngines: string[];
  unavailableEngines: Array<{ engine: string; reason: string }>;
  metadataPresent: boolean;
  rawResults: number;
  filteredResults: number;
  elapsedMs: number;
  status: "success" | "empty_results" | "filtered_urls" | "engines_unavailable" | "timeout" | "network_error";
}
export interface SearchDiagnostics {
  observedAt: number;
  attempts: SearchAttemptDiagnostics[];
  availability: "healthy" | "degraded" | "unknown" | "unavailable";
  singleEngine: boolean;
}

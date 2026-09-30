# SearXNG diagnostics and recovery (#67)

Search now returns bounded contributing-engine provenance and partial failures on success, and structured causes on failure. Single-engine success is degraded, absent metadata is unknown, legitimate empty results are successful empty searches, and filtered results differ from unavailable engines. Settings displays the last observation beside its engine catalog. Observations expire after five minutes and are replaced by each new search, so service recovery/restarts are reevaluated instead of permanently blacklisting engines.

Fallback is an explicit comma-separated shortcut selection, disabled by default: `bi` is a candidate, not a claim of availability. Exactly one retry occurs only for engine unavailability, never for CAPTCHA bypass, empty results, URL filtering or cancellation. Per-request deadline remains 8 seconds; both attempts share a 16-second ceiling. No paid service, API key or credits are used.

Controlled HTTP fixtures cover degradation, missing metadata, fallback and recovery. Live search measurements and restart comparison must be run against the user's managed SearXNG instance; no server restart has been performed here. Distinguish integrated-terminal command deadlines from independent HTTP request timings. See the probe script for timestamped default, engine and sequential/concurrent samples.

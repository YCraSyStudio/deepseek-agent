[Back](INDEX.md)

# Overflow Protection

Overflow control is generation-scoped. `GenerationBudgetManager` combines model capabilities, the configured output allowance, conservative UTF-8 token estimates, provider usage calibration, compaction count, and concise-recovery state. DeepSeek V4.1 Flash uses the registered 1M-token context and 384K output capabilities; the configured allowance defaults to the 384,000-token maximum unless the user lowers it. Unknown compatible endpoints fall back to 128K context and 8,192 output tokens.

Requests are assessed as `within_budget`, `compaction_required`, or `hard_limit`. The preventive threshold is 80% of usable input and the terminal threshold is 95%; a non-consumable margin of 5% or 16K tokens is reserved. Context is checked before the first provider call and at every completed tool-round boundary. Active tool protocols are never cut in the middle.

Conversation compaction persists schema-2 boundaries. A boundary records its digest, the generation IDs newly covered by that operation, estimates, reason, and timestamp; the summary keeps the cumulative covered-ID set used to exclude old messages from later provider requests. The webview shows a localized compaction marker and the marker survives reloads.

Tool-cycle rollover creates a bounded continuity ledger only after all emitted calls have terminal outcomes. Executed signatures and mutation-failure guards stay live in generation memory, so rollover cannot authorize repeated mutations. Each model-facing tool result is limited to 128 KiB and 16K estimated tokens; lower tool-specific limits, including the 8 KiB web-content envelope, remain authoritative. That bound is per result, not cumulative: a long cycle is never interrupted for having collected many results, since rollover and compaction already cap what reaches the provider.

Reasoning and visible content share the configured output budget. A reasoning-dominated attempt approaching 80% is cancelled once and retried from the last safe request with thinking disabled. A second approach to the limit is saved as incomplete. The real provider finish reason is retained, and partial, malformed, or length-truncated tool calls are never executed.

Transport and persistence have independent byte limits: 1 MiB per SSE event, 2 MiB pending SSE data, 16 MiB non-streaming chat responses and checkpoints, 4 MiB history segments, and 256 MiB total inactive-history retention. Queues, webview replay, browser work, terminal presentation, and concurrent generation admission also have explicit resource governors. Limit failures are visible; data is never silently dropped.

[Back](INDEX.md)

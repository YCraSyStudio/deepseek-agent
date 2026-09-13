## Context

Stable prefixes, per-phase usage, and adaptive completion-review prefix reuse are implemented. Security review and automatic/manual compaction now share `AuxiliaryModelPolicy.ts`: only verified official-model combinations may select Flash; custom and unknown models retain their selection.

With only `deepseek-flash` registered, routing remains unchanged. Each primary, tool, review, and compaction usage callback identifies the requested model. Mixed-model generations retain flat per-model/per-phase aggregates through persistence and conversation totals, feeding the existing model breakdown in the usage panel. Unknown prices remain unavailable instead of using Flash rates, and missing usage is counted without inventing tokens. Legacy single-model history remains readable.

Automated tests cover mixed-model attribution, persistence validation, and unavailable auxiliary requests: security review requires confirmation; compaction retains local evidence and reports the failed request against its selected model. Neither path silently substitutes a custom model.

The historical cache/usage comparison is complete by user acceptance: approximately 82% before versus 92–96% in recorded captures. See the [accepted baseline](usage-history-baseline-2026-09-12.md#accepted-comparison-and-closure).

## Objective

Enable cheaper auxiliary routing once a compatible second model is available, with accurate costs and measured cache reuse.

## To-Do List

- [ ] Validate a second model, register its prices, and extend the verified routing combinations. Blocked: the project currently registers and prices only Flash.
- [ ] Validate cache reuse and actual auxiliary cost when second-model routing becomes available, recording model, tier, and currency. Depends on the second-model integration; the historical Flash comparison is already accepted.

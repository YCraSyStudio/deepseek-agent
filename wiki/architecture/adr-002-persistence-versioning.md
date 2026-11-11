[Back](2.INDEX.MD)

# ADR 002 · Persistence Versioning and Validation

## Context

The compatibility window for legacy conversations ended in `0.1.11`. Persisted conversations and generation checkpoints need an explicit format and a workspace binding that can be validated before use. [Issue #61](https://github.com/YCraSyStudio/deepseek-agent/issues/61)

## Decision

Conversations use `schemaVersion: 2` and generation checkpoints use schema 3. Both require a complete workspace binding whose URI matches the persisted workspace URI. Writes are atomic and guarded by filesystem locks.

Each conversation lives in `history/<id>/`. Its `manifest.json` holds versioned metadata, and messages are stored in numbered chunks of up to 4 MiB, such as `0.json` and `1.json`.

## Consequences

Activation validates each conversation directory before use. It permanently deletes unsupported, malformed, oversized, incomplete or index-inconsistent conversation data, along with legacy flat `history/*.json` files and the obsolete `.segments` directory. It also deletes unsupported checkpoints and obsolete quarantine directories.

The application rejects invalid in-memory values before saving and does not silently repair invalid records. The legacy conversation parser, activation-time migration of legacy conversations, workspace-state import, legacy workspace fallback and checkpoint permission-mode rewrite have been removed. See [settings, secrets, and history](../settings-and-data/settings-secrets-and-history.md) for the storage layout.

[Back](2.INDEX.MD)


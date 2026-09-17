# ADR 002: Persistence versioning and strict validation

Status: accepted

Stored conversations use `schemaVersion: 2`; generation checkpoints use schema 3. Both require a complete workspace binding whose URI matches the persisted workspace URI. Writes remain atomic and guarded by filesystem locks.

The compatibility window tracked by [issue #61](https://github.com/YCraSyStudio/deepseek-agent/issues/61) ended in `0.1.11`. There is no legacy conversation parser, activation-time migration, workspace-state import, legacy workspace fallback, or checkpoint permission-mode rewrite.

Each conversation is stored in its own directory, `history/<id>/`, holding a `manifest.json` with the versioned metadata and one message chunk per 4 MiB slice, named by auto-incrementing index (`0.json`, `1.json`, …). At activation, every conversation directory is validated before use. Unsupported, malformed, oversized, incomplete, or index-inconsistent manifests and chunks are permanently deleted, together with legacy flat `history/*.json` files and the obsolete `.segments` directory. Unsupported checkpoints and obsolete quarantine directories are also deleted. Current-format records are never repaired silently; invalid in-memory values are rejected before save.


# ADR 002: Persistence versioning and strict validation

Status: accepted

Stored conversations use `schemaVersion: 2`; generation checkpoints use schema 3. Both require a complete workspace binding whose URI matches the persisted workspace URI. Writes remain atomic and guarded by filesystem locks.

The compatibility window tracked by [issue #61](https://github.com/YCraSyStudio/deepseek-agent/issues/61) ended in `0.1.11`. There is no legacy conversation parser, activation-time migration, workspace-state import, legacy workspace fallback, or checkpoint permission-mode rewrite.

At activation, every JSON file in the conversation directory is validated before use. Unversioned, unsupported, malformed, oversized, mismatched-name, or incomplete records are permanently deleted together with their segments. Unsupported checkpoints and obsolete quarantine directories are also deleted. Current-format records are never repaired silently; invalid in-memory values are rejected before save.


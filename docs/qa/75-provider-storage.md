# Issue #75 validation

`agent/75-provider-storage` is based directly on `develop-agent`, with no capture prerequisite. Compile, lint and 461 unit tests pass, including five storage migration/recovery fixtures and existing transactional settings/history/checkpoint coverage. No user data was migrated during development; fixtures use temporary directories.

Manual upgrade: copy an existing user data fixture, start extension, verify provider fields move to the dedicated directory and history/checkpoints/SearXNG remain accessible. Reopen, save tuning and general settings, reset, and verify secrets stay in SecretStorage. For a permissions failure verify degraded incognito state and preserve the journal for recovery.

## Cloud acceptance, 2026-10-18

Read issue #75 before testing. Compile and lint pass; 483 unit tests pass (the architecture scan needed a larger runner timeout on the shared host). A temporary legacy settings file and an existing provider destination were migrated using the production storage implementation: destination ownership won, shared fields stayed shared, repeated writes were idempotent, and a failure between writes recovered on restart. The migrated model configuration made a real `deepseek-flash` completion returning `STORAGE_OK`. The temporary API credential stayed in memory and was absent from both settings files. Estimated model cost: CNY 0.000023; evidence: [75-storage.json](live/75-storage.json).

These fixtures do not replace an interactive upgrade on Windows/macOS. History/checkpoint paths and VS Code SecretStorage were inspected and are not migration inputs.

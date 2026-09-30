# Provider storage boundary

Provider convention: `~/.ycrasy-agent/<provider>/`, with a validated lowercase namespace. DeepSeek owns `settings.json` containing `baseUrl`, `model`, `thinkingMode`, `reasoningEffort`, `temperature`, `topP` and `maxTokens`. The application still sees one normalized AppConfig through SettingsRepository; the UI and shared history do not resolve provider paths. ProviderDataPaths and SettingsStorage define the persistence boundary for future adapters.

| Data | Owner | Destination / behavior |
| --- | --- | --- |
| Endpoint/model/generation tuning | DeepSeek | `~/.ycrasy-agent/deepseek/settings.json` |
| Credentials | DeepSeek credential adapter | Existing VS Code SecretStorage; never exported |
| General settings, permission mode, history policy, language, usage display | Shared core | Existing `~/.deepseek-agent/settings.json` |
| Conversations, screenshots, checkpoints | Shared core | Existing history and generation-checkpoints paths |
| SearXNG runtime/config/cache | Shared core | Existing runtime paths |
| Instructions discovery | Shared core | Existing project/home discovery |
| Image attachment preview bytes | Shared attachment capability | Existing extension globalStorage/image-attachments cache; provider remote IDs remain attachment metadata |
| Remote DeepSeek files, usage and model service responses | DeepSeek adapter | Remote API/session memory; no additional filesystem file to relocate |

## Migration and recovery

Migration overlays existing destination provider fields on legacy fields, retaining legacy fields absent at destination. It normalizes the combined config, writes an atomic transaction journal beside shared settings, writes provider settings, then shared settings without provider keys, and finally removes the journal. An interrupted write is replayed under the existing shared settings lock. Both expected old and intended new hashes are accepted so replay is idempotent; an externally changed file causes a visible degraded-storage error and is never overwritten. Preserve the journal and both files if resolving such a conflict manually. Invalid JSON fails visibly rather than silently discarding settings. Missing files are fresh-install defaults. Atomic writers retain restricted modes and recoverable replacement behavior.

Multiple future extensions must use the same shared settings lock and transaction protocol, plus the existing history mutation lock for history/captures. They must not independently migrate, rewrite complete settings from stale snapshots or silently bypass lock failures. Concurrent old extensions unaware of this protocol are unsupported; a detected interrupted-transaction conflict fails closed. Splitting into additional extensions is outside this issue.

Tests override provider storage with `YCRASY_AGENT_PROVIDER_DATA_DIR`; without it, test provider paths are inside `DEEPSEEK_AGENT_USER_DATA_DIR/providers`, never the real home provider directory. Production ignores these overrides. Fresh install, destination precedence, repeated migration, interrupted recovery, external conflict and credential exclusion have automated coverage; existing history/checkpoint tests continue to pass.

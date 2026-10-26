# Provider storage boundary

Provider convention: `~/.ycrasy-agent/<provider>/`, with a validated lowercase namespace. DeepSeek owns `settings.json` containing `baseUrl`, `model`, `thinkingMode`, `reasoningEffort`, `temperature`, `topP` and `maxTokens`. The application still sees one normalized AppConfig through SettingsRepository; the UI and shared history do not resolve provider paths. ProviderDataPaths and SettingsStorage define the persistence boundary for future adapters.

| Data | Owner | Destination / behavior |
| --- | --- | --- |
| Endpoint/model/generation tuning | DeepSeek | `~/.ycrasy-agent/deepseek/settings.json` |
| Credentials | DeepSeek credential adapter | Existing VS Code SecretStorage; never exported |
| General settings, permission mode, history policy, language, usage display | Shared core | `~/.ycrasy-agent/settings.json` |
| Conversations, screenshots, checkpoints | Shared core | `~/.ycrasy-agent/history/` (including per-chat `checkpoint.json`) |
| Legacy runtime/config/cache | Shared core | Corresponding directories under `~/.ycrasy-agent/` |
| Instructions discovery | Shared core | Existing project/home discovery |
| Image attachment preview bytes | Shared attachment capability | Existing extension globalStorage/image-attachments cache; provider remote IDs remain attachment metadata |
| Remote DeepSeek files, usage and model service responses | DeepSeek adapter | Remote API/session memory; no additional filesystem file to relocate |

## Migration and recovery

The shared data root is now `~/.ycrasy-agent/`. On the first activation of the new version, if `~/.deepseek-agent/` exists, activation moves its contents into that root without replacing the existing `deepseek/` provider directory, then removes the empty old directory. No compatibility link or separate migration script remains. Subsequent starts skip migration when the old directory is absent. A pre-existing compatibility link pointing to the new root is also removed without deleting the data. Migration uses settings locks and a destination migration lock, resumes after top-level entries have already moved, and refuses conflicting entries before moving further data. A conflict leaves both copies intact and enters degraded mode instead of overwriting them. No user-home migration runs in unit tests.

Before root migration, activation removes the obsolete `runtimes/` and `runtime-state/` directories in full from the legacy home directory, default data root and selected data root. Settings, history, snapshots and instructions are preserved. Runtime symlinks themselves are removed without following their external targets. It creates no standalone script or completion marker: missing directories are skipped on later starts, and failures are logged and retried on a subsequent activation without independently disabling chat. Tests use temporary directories, never real home runtime folders.

Migration overlays existing destination provider fields on legacy fields, retaining legacy fields absent at destination. It normalizes the combined config, writes an atomic transaction journal beside shared settings, writes provider settings, then shared settings without provider keys, and finally removes the journal. An interrupted write is replayed under the existing shared settings lock. Both expected old and intended new hashes are accepted so replay is idempotent; an externally changed file causes a visible degraded-storage error and is never overwritten. Preserve the journal and both files if resolving such a conflict manually. Invalid JSON fails visibly rather than silently discarding settings. Missing files are fresh-install defaults. Atomic writers retain restricted modes and recoverable replacement behavior.

Settings → General → Extension includes a data folder field that provides an editable root path and the native folder picker. Leaving the path field or pressing Enter automatically saves a machine-local selection in VS Code globalState, outside the chosen root; reload activates it for all storage clients. Default restores `.ycrasy-agent` in the extension host user’s home directory (`$HOME` on Linux/macOS, `%USERPROFILE%` on Windows). Existing data remains in its original directory; selecting a directory uses the data already stored there. New directories are created and checked for read/write access before saving. Credentials and attachment preview cache remain in VS Code storage.

Multiple future extensions must use the same shared settings lock and transaction protocol, plus the existing history mutation lock for history/captures. They must not independently migrate, rewrite complete settings from stale snapshots or silently bypass lock failures. Concurrent old extensions unaware of this protocol are unsupported; a detected interrupted-transaction conflict fails closed. Splitting into additional extensions is outside this issue.

Tests override provider storage with `YCRASY_AGENT_PROVIDER_DATA_DIR`; without it, test provider paths are inside `DEEPSEEK_AGENT_USER_DATA_DIR/providers`, never the real home provider directory. Production ignores these overrides. Fresh install, destination precedence, repeated migration, interrupted recovery, external conflict and credential exclusion have automated coverage; existing history/checkpoint tests continue to pass.

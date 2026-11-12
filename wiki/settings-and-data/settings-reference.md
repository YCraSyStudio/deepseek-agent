[Back](2.INDEX.MD)

# Settings Reference

Settings live in extension-owned JSON files, not in the VS Code `configuration` contribution. `SettingsManager` normalizes every read and write; out-of-range values are clamped and invalid enums fall back to their default. The API key is a secret, not a setting, and is stored per normalized API origin in VS Code Secret Storage.

## Tabs and sections

| Tab | Sections |
| --- | --- |
| General | Extension, Storage, Usage, Privacy. |
| API | Credentials and model, Beta features, Advanced. |
| Tools | Tool catalog, permission mode, capture permission, Web search. |
| Customization | Global `AGENTS.md`, workspace `AGENTS.md`, reusable instructions. |

## General

| Key | Default | Accepted values | Effect |
| --- | --- | --- | --- |
| `interfaceLanguage` | `auto` | `auto`, `en`, `es`, `zh` | UI and host-message language. `auto` follows the editor locale. |
| `historyRetentionDays` | `30` | 0–3650 | Retention window. `0` disables age-based expiry; the setting is disabled while history is off. |
| `maxConcurrentGenerations` | `8` | 1–16 | Generations allowed across conversations. A conversation still runs one turn at a time. |
| `snapshotStorageLimitMb` | `1024` | 64–65536 | Shared quota for recovery snapshots across chats. At least 100 MiB free disk space is reserved. |
| `usageCostCurrency` | `usd` | `usd`, `cny` | Prices the usage popover with DeepSeek's published table for that currency. |
| `usageBreakdown` | `false` | boolean | Shows the per-model token breakdown in the usage popover. |
| `privacyMinimizeData` | `true` | boolean | Reduces optional context sent to the provider. It does not disable the conversation itself. |

The Storage section also selects the active data directory. That path is managed outside `AppConfig` through `setStorageDirectory`, `selectStorageDirectory` and `reloadStorage`, and takes effect after reload.

## API

| Key | Default | Accepted values | Effect |
| --- | --- | --- | --- |
| `baseUrl` | `https://api.deepseek.com` | Normalized HTTPS URL or loopback HTTP URL | Provider origin. A non-DeepSeek origin shows a warning and receives no official pricing assumptions. |
| `model` | `deepseek-v4-flash-vision-exp` | `deepseek-v4-flash-vision-exp`, `deepseek-v4-pro` | Active model. |
| `thinkingMode` | `true` | boolean | Enables reasoning. When off, sampling controls and `reasoningEffort` do not apply. |
| `reasoningEffort` | `high` | `low`, `high`, `max` | Reasoning effort while thinking mode is on. |
| `temperature` | `1.0` | 0–2, step 0.05 | Sampling temperature, shown only when thinking mode is off. |
| `topP` | `1.0` | 0–1, step 0.05 | Nucleus sampling, shown only when thinking mode is off. |
| `maxTokens` | `384000` | 1–384000 | Output allowance. Beta completion tools cap their own requests well below this value. |
| `betaFeaturesEnabled` | `false` | boolean | Exposes beta completions, strict tool calls, editor suggestions and chat suggestions. Does not change the provider or API origin. |
| `strictToolCallsEnabled` | `false` | boolean | Uses strict function schemas while beta features are enabled. Disabled automatically when beta features are turned off. |
| `editorSuggestionsEnabled` | `true` | boolean | Allows automatic inline editor completions while beta features are enabled. |
| `chatSuggestionsEnabled` | `true` | boolean | Shows the manual chat-suggestion action while beta features are enabled. |

The API key is written with `saveConfig` (`apiKey` only), read back as a configured/missing status with a masked preview, and removed with `deleteApiKey`. It never enters `AppConfig`, history, checkpoints or logs.

## Tools

| Key | Default | Accepted values | Effect |
| --- | --- | --- | --- |
| `permissionMode` | `default` | `default`, `auto-approve`, `full-access` | Approval policy for tool calls. |
| `capturePermission` | `ask` | `ask`, `first-use`, `always` | Permission for explicit and automatic captures of web pages, native windows and monitors. |
| `webSearchEnabled` | `true` | boolean | Sends or removes both `search_web` and `read_web`. There is no separate read toggle. |
| `webSearchRegion` | `global` | `global`, `auto`, two-letter country code | Soft regional preference for search. `auto` uses the local system locale. |

## Customization

| Key | Default | Accepted values | Effect |
| --- | --- | --- | --- |
| `includeHomeAgents` | `false` | boolean | Loads the global `AGENTS.md` from the active data directory in addition to workspace instructions. |

Reusable instruction files are not settings. Their scope, catalog limits and selection rules are described in [Settings, History, and Privacy](settings-history-and-privacy.md#instructions).

## Persistence and precedence

- General settings and provider settings are written to separate files under the active data directory and share one confirmed in-memory revision.
- The renderer receives only the settings it needs; secrets stay in the host.
- A save increments the revision. Pending generation and suggestion requests compare revisions and are discarded when settings change.
- Insufficient snapshot quota does not block a message; it disables revert for that turn and leaves earlier recovery copies intact.
- Changing the data directory does not migrate conversations, credentials or instructions automatically; the new directory becomes active after reload.

## Related

- [Settings, history, and privacy](settings-history-and-privacy.md)
- [Provider storage, migration, and recovery](provider-storage.md)
- [Workspace recovery](../tools-and-permissions/workspace-recovery.md)
- [Editor assistance](../extension-and-interface/editor-assistance.md)

[Back](2.INDEX.MD)

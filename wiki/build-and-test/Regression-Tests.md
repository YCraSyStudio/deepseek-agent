# Pre-refactor regression tests

The production behavior is the reference. Add tests through public handlers, protocol messages and real React hooks before changing
production code. A test must assert an observable result: returned data, emitted messages, persisted state, filesystem changes, user decisions or cleanup. Executing code alone does not establish the expected behavior.

## Commands

- `npm run test:unit`: all unit and handler characterization tests.
- `npm run test:unit -- --grep characterization`: focused characterization tests.
- `npm run test:integration`: real VS Code extension-host flows.

## Characterization added

| Area | Observable behavior protected |
| --- | --- |
| Settings handler | Save/reset/cancel, explicit origin and full-access confirmations, secret-store separation, masking, errors, credential deletion, connection checks without persistence |
| History handler | Presentation-only data, request-correlated errors, 200-message and byte-limited paging, stale selections, delete/cancel/undo, concurrent updates, partial bulk deletion, resource cleanup |
| Incognito transitions | Stop-work prompt, request/view matching, cancellation, view recreation, durable mode changes, save/discard private messages, reset, persistence and promotion failures, repeated decisions |
| Streaming React hook | Chunk batching, frame/timer flush, empty chunks, reasoning separation/limits, tool ordering/deduplication, generation reset, restored message reuse, unmount cleanup |
| Mounted application | Composer submission/streaming/cancel, rejected drafts, stale navigation, history search/sort/group/paging/delete, tool execute/reject, incognito prompts, settings tabs, correlated security and instruction updates |
| Settings customization/storage | Actual temporary instruction files, locales, preservation, missing/error/stale scans, local directory picker/cancel, reload, watcher rebinding/disposal, history transitions |
| Path mutations | Move/delete confirmation, content hashes, no-overwrite, directory recursion, trash/permanent mode, unsupported hosts, errors and malformed requests |
| Command file context | POSIX/Windows paths, quoting, shell segments/interpreters, bounded previews, binary/UTF-8 handling, sensitive and untrusted operand rejection |
| Workspace path boundaries | Logical aliases, external admission, traversal/sensitive/symlink rejection, remote segments, search fanout and native cancellation cleanup |
| VS Code workspace host | Real closed-file read/write/move/delete, unsaved-buffer reads, bounded previews, multi-root limits, symbol hierarchy, rejected editor changes, trash failure admission and owned shell output |
| Manual compaction | Selected/open chat, active/queued generations and history-transition gates, credentials, summary/marker persistence, usage/context messages, offline fallback, cancellation and retry |
| Workspace coordination | Context binding, confirmed/stale rebind, persistent audit history, background selection, queue recovery, interruption completion, native opening and folder-change handling |
| Command safety boundaries | Strict response schema/confidence/risk, malformed action rejection, credential redaction before remote requests, mutation-payload omission, mechanical scope, bounded intent, usage and cancellation |
| Web network policy | Route/site/subresource grants, HTTPS validation, reserved IP range boundaries, native/mapped IPv6, all-answer DNS resolution, mixed-address rejection and timeout cleanup |
| Webview recovery protocol | Saved-turn review/diff/picker/revert on real snapshots, disconnected-workspace protection, native screenshot preview/open, clipboard upload/delete acknowledgements and connected path completion/open |
| Generation executor | Real conversation/history state, permission/credential failures, primary streams, partial errors/cancellation, terminal deduplication, persistent turns, tool results and incognito recovery/image admission |
| Mounted settings workflows | Loading/retry, stale revisions and locale, keyboard tabs, correlated storage/instruction/credential results, numeric bounds, tool catalog/search, privacy/usage, beta dependencies and unavailable host |
| Tool session lifecycle | Real tool registry/executor/cycle with HTTP-boundary responses: automatic/manual/danger admission, duplicate/missing actions, cancellation, refreshed permissions, capture outcomes, mutation-failure blocking and explicit/budget-limited compaction |
| Responsive composer footer | Attachment request correlation, supported permissions and pending state, compact/wide layouts, usage panel placement, reference removal and suggestion request/cancel |
| Mounted chat workflows | Picker/clipboard attachments through submission, removed and late-upload cleanup, persistent draft restore/edit/submit and storage errors, recovered draft context, workspace rebind/cancel, running-task stop/retry and correlated manual compaction |
| Project instruction loading | Real AGENTS.md files, home opt-in, root/local precedence and labels, delimiter escaping, byte limits, empty/missing/error files and cancellation |
| Host-to-webview routing | Versioned initialization, all dispatched event payloads, scoped stale-event rejection, updated callbacks, optional observers, locale updates and listener cleanup |
| Chat message lifecycle | Stream reconciliation and stale-generation filtering, terminal states, incomplete provider answers, error deduplication, usage targeting, snapshots, external history replacement and optional observers |
| Reusable instruction host | Real temporary global/workspace files, create/open results, editor failures, stale concurrent catalogs, catalog errors and watcher disposal |
| Message images and list | Numbered and unnumbered previews/fallbacks, enlarge/close/reference events, escaped role output, scroll anchoring, jump to latest, saved-history paging and scoped compaction/recovery states |
| Streaming termination | Explicit incomplete finish reasons, partial-result retention, original early failures and one concise recovery preserving input messages |
| Browser capture lifecycle | Owned CDP pipes, actual child-process termination and temporary-profile removal after success, navigation failure and oversized screenshots |
| Reusable instructions UI | Loading/grouping, validated and trimmed creation, templates, workspace scope/fallback, pending controls, correlated open/create success and failure, reset and cancel |
| Composer input | Send/steer/queue/cancel payloads, references, clipboard previews/limits, image preparation failures and unmount, duplicate prevention, keyboard path selection and ghost suggestion acceptance |
| Git recovery | Real committed, modified, staged, deleted, ignored, untracked and bare repository paths; cancelled probes and Git disappearing between stages |
| Path completions hook | Debouncing, request/workspace correlation, deduplication, group ordering, file/directory/instruction insertion, caret restoration and lifecycle cancellation |
| Storage settings UI | Trimmed blur/Enter saves, browse/default focus transitions, pending controls, persisted directory updates, reload and accessible errors |
| Workspace mismatch UI | Accessible confirmation, escaped workspace names, focus and cancellation |
| Image attachments | Classification by content, picker/clipboard uploads, limits, filename sanitization, credentials, cleanup, cache bytes, archived and restored previews |
| Composer and rendering | File selector, model/reasoning and usage menus, Markdown and code actions, tool results, activity timeline, edited-file review, screenshot preview |
| Persistence failure recovery | Atomic replacement, backup/restore failures, stale locks and unlock behavior with real temporary files |
| API settings React hook | Credential loading/masking, testing state and payload, result correlation, deletion outcomes, duplicate clicks, malformed events, edit/blur callbacks, visibility toggle |

Only VS Code UI calls and repository/provider boundaries are substituted in the
handler tests. The production handlers, protocol shapes, presentation conversion,
usage calculation and React lifecycle execute for real. Existing tests keep their
original module resolution; the VS Code test double is limited to the handler
characterization directory.

## Agreed scope: essential regression protection

The user revised the scope to essential behavior before the large refactor.
Keep passing behavior assertions for these workflows:

| Essential behavior | Representative suites |
| --- | --- |
| Send, stream, use tools, cancel, save and reopen conversations | GenerationExecutor, ChatHandler, ToolCallSession, ChatE2e integration |
| Preserve reasoning across tool calls and saved transcripts (HTTP 400 regression) | ProviderContract, ConversationState, ConversationNormalization |
| Preserve user files, unsaved edits and recoverable changes | WorkspaceRestoreStore, WorkspaceSnapshot, extension-host undo/redo integration |
| Enforce workspace boundaries, approvals and secret redaction | PipelineScope, DeterministicApproval, Diagnostics |
| Keep drafts, attachments, settings and daily chat interactions | AppFlow, PersistentChatState, settings and attachment suites |
| Continue after unavailable automatic capture and persist compaction | GenerationExecutor, AutomaticCaptureSession, ManualCompaction |
| Prevent runaway test memory and preserve assertion failures | Memory guard self-checks and monitored unit runner |

The final increment adds cancellation/cleanup checks, a missing native-capture
anchor check, and two generation-level persistence/continuity regressions.
Windows termination is simulated at the process boundary; it does not establish
native Windows execution. Provider tests use controlled responses and do not
establish that a live DeepSeek request now succeeds. Linux extension-host tests
exercise the actual VS Code runtime.

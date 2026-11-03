# Pre-refactor regression coverage

The production behavior is the reference. Add tests through public handlers,
protocol messages and real React hooks before changing production code. A test
must assert an observable result: returned data, emitted messages, persisted
state, filesystem changes, user decisions or cleanup. Executing code alone does
not establish the expected behavior.

## Commands

- `npm run test:unit`: all unit and handler characterization tests.
- `npm run test:unit -- --grep characterization`: focused characterization tests.
- `npm run test:integration`: real VS Code extension-host flows.
- `npm run test:coverage`: unit coverage, including unexecuted production files.
- `npm run test:coverage:full`: combined unit and real extension-host coverage.
- `npm run test:coverage:check`: the combined suite, enforcing 100% lines, statements,
  functions and branches **per file**. This optional diagnostic is expected to
  fail on residual gaps; it is not the acceptance gate for the agreed scope.

Open `coverage/index.html` for missing lines and branches. Machine-readable
results are in `coverage/coverage-summary.json`; raw V8 results are in
`.tmp/coverage`. Reports are generated even when a unit test fails, and the
command preserves that failure status.

The unit-only command does not include extension-host execution. The full command
starts V8 precise coverage inside VS Code before loading the test modules, records
it in root teardown even when assertions fail, and merges it with unit coverage.
The full runner rejects a successful run if known extension-host modules have no
real function coverage. On Linux, run graphical tests with `xvfb-run -a` to avoid
routing editor commands to unrelated controls on the foreground desktop.

Integration uses a unique temporary workspace outside the development checkout.
A native integration assertion verifies that its active folder matches the fixture
path and is outside the extension directory. Snapshot restoration therefore cannot
revert source edits in the repository. The fixture creates its own manifest, the
bounded-preview case creates and deletes its own large JSON file, and the CLI
removes the temporary workspace on exit. The verified run left no fixture directories.

Coverage integration builds keep production bundling but disable minification.
`v8-to-istanbul` can replace a correct source mapping with the mapping at the
start of the generated line when that line belongs to another source. A
minified line containing several modules therefore attributed unrelated
functions to prompt text and falsely marked unexecuted lines covered.
The audit reproduced 20 function declarations mapped into template literals.
`scripts/coverage-map-validation.mjs` now rejects such reports and writes
`coverage/mapping-validation.json`; the corrected combined report has zero
issues. Ordinary production builds remain minified. Earlier combined line
percentages (including 96.65%) were overstated and are superseded by the
corrected measurement below. No production sources were excluded to fix this.

`coverage/source-inventory.json` lists every production source. The same esbuild
transform used for tests identifies modules that emit no executable JavaScript:
25 declaration-only modules and 22 pure named re-export barrels are recorded
explicitly as emitting no own executable statements in the bundled runtime. No module emitting runtime code is excluded by this classification.
Inventory tests protect side-effect imports, classes, enums, functions and JSX.
Do not exclude runtime modules, add coverage-ignore directives or relax assertions
to make a percentage pass.

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
Coverage remains diagnostic: do not add artificial cases solely to reach 100%,
remove existing tests or change exclusions/thresholds to improve the percentage.
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
exercise the actual VS Code runtime. Unreachable or redundant residual branches
remain visible in the report and do not justify more tests by themselves.

## Verified state on 3 November 2026

- Original unrestricted unit baseline: 755 passing.
- Expanded unit suite: 2093 passing, plus two assertion/RSS memory safety checks.
- Latest increment: ten essential regressions for search cancellation, safe terminal
  termination, absent native capture anchors, automatic-capture failure continuity
  and persisted tool-cycle compaction. All pass in the complete suite.
- The preceding increment added five tests for per-run web taint, remote security approval/usage
  in a scoped workspace and inserting chat code across selections with foreign or
  stale-workspace rejection. `ToolCallSession.ts` and `EditorActions.ts` now have
  100% function coverage; their remaining branches stay visible.
  No source exclusions or coverage thresholds changed.
- The preceding increment added seven tests for source/destination containment proofs, malformed
  move destinations, saved-conversation restoration with early generation failure,
  pending history-decision rejection and borrowed vision attachment endpoint/expiry
  checks. `ChatHandler.ts` reaches 100% in all four metrics; `PipelineContext.ts`
  reaches 100% lines/statements/functions and 95.74% branches.
  No source exclusions or coverage thresholds changed.
- The preceding increment added seven tests for caller-aborted capture/late results, workspace
  empty/changed/disconnected states, showing active diagnostics, linear large-file
  diff truncation with full counts and default chat completion/cache behavior
  through the actual beta adapter. The touched modules now have 100% function
  coverage; their remaining line/branch gaps remain visible.
  No source exclusions or coverage thresholds changed.
- The preceding increment added seven tests for explicit chat suggestions, composition
  cancellation/retry, stale replies, scope/cursor/focus changes, suggestion limits,
  live web-search disposal and compaction through the public tool executor.
  `UseChatSuggestions.ts` and `CompactContext.ts` reach 100% in all four metrics;
  `DeepSeekWebClient.ts` reaches 100% lines/statements/functions and 93.33% branches.
  No source exclusions or coverage thresholds changed.
- The preceding increment added 14 mounted React tests for history transition decisions across
  entering/leaving incognito and active/queued/finished work, reasoning/model
  actions, correlated permission acknowledgements, stale revisions and manual-only
  batch tool decisions. `HistoryTransitionPanel.tsx` reaches 100% in all four
  metrics; configuration and tool controllers retain their remaining branch gaps.
  No source exclusions or coverage thresholds changed.
- The preceding increment added seven tests for settings repository persistence/revisions,
  trusted/untrusted permission snapshots, degraded storage, origin-scoped secret
  migration/replacement/deletion and numeric input controls. `RepositoryAdapters.ts`
  and `NumberInput.tsx` reach 100% in all four metrics. The numeric DOM fixture
  routes negative stepUp calls through jsdom stepDown because its stepUp
  implementation otherwise rejects the decrement; production code is unchanged.
  No source exclusions or coverage thresholds changed.
- The preceding increment added 16 HTTP transport tests for bounded/numeric/date retry delays,
  exponential network retries, cancellation before/during waits, HEAD/OPTIONS
  attempt limits, POST-to-GET redirects, redirect loops/missing locations and safe
  non-JSON error handling. `DeepSeekFetch.ts` reaches 100% lines/statements/functions
  and 95.90% branches. No source exclusions or coverage thresholds changed.
- The preceding increment added 19 tests for duplicate/unfinished turns, invalid manifests,
  created/deleted-file diffs, tampered and non-text backups, symlink restoration,
  concurrent edits, index repair/refusal, deleted conversations and Cargo/Maven
  generated output. Workspace recovery reaches 95.76% branches and snapshots
  92.51%; their remaining gaps stay visible. No source exclusions or coverage
  thresholds changed.
- The preceding increment added eight tests for browser parameter boundaries (Unicode queries,
  opaque IDs/cursors, focus, result limits, DNS names, language tags and literal IP
  rejection) and scoped IPv6 rejection. `NetworkPolicy.ts` reaches 99.11% branches
  and `Validation.ts` reaches 86.48%; both have 100% lines/statements/functions.
  The domain-filter IP checks are unreachable after the preceding DNS-name regex;
  the IPv6 parser multiple-compression check is preceded by node:net.isIP.
  These invariant-review candidates remain intact; no production behavior, source
  exclusions or coverage thresholds changed.
- The preceding increment added eight mounted React tests for manual/batch confirmations,
  disabled controls, Escape, destructive/dangerous/caution presentation, file
  opening, argument fallbacks and full patch reviews.
  `ToolCallConfirmationModal.tsx` and `ToolCallDangerConfirmation.tsx` reach 100%
  in all four metrics. No source exclusions or coverage thresholds changed.
- The preceding increment added nine tests for correlated draft persistence, incognito deletion,
  invalid requests, queued operations, stale responses, binary image round trips,
  encoding reuse, host failures and timeout recovery.
  `ChatDraftHandler.ts` and `DraftAttachmentsStore.ts` reach 100% in all four metrics.
  No source exclusions or coverage thresholds changed.
- The preceding increment added seven tests for registry replacement/size, JSON root rejection,
  supported schema types/defaults, interleaved streamed tool calls, suppressed UI
  deltas, live strict-setting changes and accumulated argument byte limits.
  `ToolRegistry.ts` reaches 100% in all four metrics. `ToolCallStreaming.ts` reaches
  98.13% lines/statements, 100% functions and 85.10% branches.
  No source exclusions or coverage thresholds changed.
- The preceding increment added six usage-normalization tests with matrices for pricing metadata,
  timestamps, reporting counters, flat model breakdowns, endpoint attribution,
  independent per-model/phase totals and saturated safe-integer sums.
  `UsageNormalization.ts` reaches 100% in all four metrics.
  No source exclusions or coverage thresholds changed.
- The preceding increment added ten unit tests with validation matrices for stored protocol
  messages/tool IDs, reasoning copies, summary boundaries, workspace bindings,
  reassignment history, generation states, tool confirmations, timelines and image
  limits. `ConversationValidation.ts` reaches 100% in all four metrics.
  `ProviderTranscript.ts` reaches 98.50% branches; the two remaining branches at
  protocol ordering lines 221 and 233 appear redundant with preceding validation
  and pending-call checks and require an invariant review.
  No source exclusions or coverage thresholds changed.
- The preceding increment added 14 unit tests for owned CDP subscriptions/removal, absent
  response fields, malformed/oversized packets, output/write failures, bounded
  diagnostics, handshake validation, pre-cancellation and request timeout/reuse.
  `HeadlessBrowserSession.ts` reaches 100% lines/statements/functions and 93.84%
  branches; four branches remain. No source exclusions or coverage thresholds changed.
- The preceding increment added ten unit tests for owned browser CDP document extraction,
  navigation/interception decisions, extraction and redirect failures, cancellation,
  profile/process cleanup, proxy owner abort and cache eviction/expiry.
  `HeadlessWebRuntime.ts`, `PublicWebProxy.ts` and `BrowserCache.ts` reach 100%
  lines/statements/functions; remaining branch gaps are 1, 2 and 1 respectively.
  No source exclusions or coverage thresholds changed.
- The preceding increment added five unit tests for PNG row predictors/format rejection and
  provider factory isolation, configuration changes, model discovery, default model
  selection, connection success and non-Error failure reporting.
  `NativePixelValidation.ts`, `DeepSeekProvider.ts` and
  `DeepSeekModelProviderFactory.ts` reach 100% in all four metrics.
  No source exclusions or coverage thresholds changed.
- The preceding increment added nine unit tests for extension shutdown (including provider failure
  and replacement during shutdown), real owned-process cleanup, malformed JSON
  preference, file/directory conflicts and redirected/unwritable migration backups.
  `Deactivate.ts` and `ExtensionRuntime.ts` reach 100% in all four metrics;
  `MergeUserData.ts` reaches 95.94% branches. No source exclusions or coverage
  thresholds changed.
- The preceding increment added 12 unit tests for device-boundary migration fallback, copy and
  inspection failures, existing/tampered backups, privilege/policy checks and
  Git-recoverable path decisions. Real disk operations remain in place apart from
  the individual injected failure. `DeterministicApproval.ts` reaches 100% in all
  four metrics; `MergeUserData.ts` reaches 100% lines/statements/functions and
  90.14% branches. No source exclusions or coverage thresholds changed.
- The preceding increment added seven unit tests for persistent recovery with default idle checks,
  trust/dirty/busy guards and successful retry, non-Error document failures, malformed
  native window catalogs and selected-instruction context persistence.
  `WorkspaceChangeTracker.ts` and `NativeWindowCatalog.ts` now reach 100% in all
  four metrics. No source exclusions or coverage thresholds changed.
- The preceding increment added 16 unit tests covering native window helper dispatch, workspace
  tracking lifecycle, interrupted confirmation results, empty provider responses and
  stream chunk dispatch/retention. `StreamEventEmitter.ts` and `ToolCallOutcome.ts`
  now reach 100% in all four metrics. Native window enumeration and workspace
  tracking reach 100% lines, with branches/functions still pending.
  No source exclusions or coverage thresholds changed.
- The preceding increment added eight unit tests for legacy IndexedDB transaction/open/version
  lifecycle, empty tool-result fallbacks and the actual Main.tsx bootstrap.
  Bootstrap builds a separate static entry and imports it only in a child process
  after creating its DOM, so ReactDOM cannot affect the remaining UI suites.
  No source exclusions or coverage thresholds changed.
- The preceding increment added 13 unit tests for Markdown envelopes/tables/code fences,
  snapshot mirror rebinding and rollback, tool-session progress review and concise
  recovery; one integration assertion protects temporary-workspace isolation.
  All 35 integration cases pass in the isolated fixture. No source exclusions or
  coverage thresholds changed.
- The preceding increment added 14 tests for workspace reference ownership, immutable
  one-use external snapshots, reference eviction, view attachment/history routing,
  image cleanup, native diff review/revert, invalid tool protocol and line-ending
  deduplication. No source exclusions or coverage thresholds changed.
- The preceding increment added 14 tests for function-reader validation and content
  budgets, search limits across files and timed-out requests, restored draft attachments,
  inactive hydration, unavailable legacy storage and asynchronous write failures.
  Search deadline tests accelerate only the 15-second timer and restore the original
  clock function. No source exclusions or coverage thresholds changed.
- The preceding increment added 27 tests for interrupted-tool normalization, bounded web
  history results, image/reference protocol payloads and limits, configuration bounds,
  API model/reasoning controls, malformed compaction ranges, cancellation and source
  chunking. No source exclusions or coverage thresholds changed.
- The preceding increment added 23 tests for history activity/filtering/paging,
  settings reset/degraded operation, persisted tool-context capabilities, dialog
  focus lifecycle and public web tunnels. Proxy tests use real loopback TCP with
  simulated DNS and upstream destination; the original built-in bindings are restored.
  No source exclusions or coverage thresholds changed.
- The preceding increment added 42 tests for progress-review schema/evidence/failures,
  structured tool-result presentation, system-browser discovery and managed Chromium
  installation, publication races and cleanup. The Puppeteer download boundary is
  substituted only in its dedicated distribution suite; filesystem operations remain real.
- The preceding increment added 32 tests for clipboard selection/shortcuts/limits,
  advanced settings edits, bounded workspace tree traversal, debug process identity
  and persisted generation recovery.
- The preceding increment added 31 behavior tests for reusable instruction handlers,
  message images and roles, message-list navigation, incomplete streams, concise
  recovery and browser capture cleanup.
- TypeScript compilation and ESLint: passing.
- Latest combined coverage: 99.20% lines/statements, 93.76% branches, 99.62% functions, with validated source-map attribution.
- Source inventory: 410 production modules: 363 with executable statements, 25 declaration-only
  and 22 pure named re-export barrels. Their implementations remain measured in
  the modules defining them.
- `ReusableInstructionsHandler.ts`, `ChatMessages.tsx` and
  `SystemBrowserCapture.ts`: 100% lines, statements, branches and functions.
- `UseChatClipboard.ts`, `AdvancedSection.tsx` and `NativeDebugAnchor.ts`:
  100% lines, statements, branches and functions.
- `ListWorkspace.ts`: 98.49% lines/statements, 96.90% branches and 100% functions.
- `GenerationRecovery.ts`: 97.24% lines/statements, 84.21% branches and 100% functions.
- `ToolCallResultPreview.tsx`: 100% lines, statements, branches and functions.
- `ChromiumProvider.ts`: 100% lines/statements/functions and 98.78% branches.
  Windows/macOS candidate selection is exercised through the platform boundary;
  these cases are not a claim of native desktop validation on those OSes.
- `ProgressReviewer.ts`: 100% lines/statements/functions and 99.11% branches.
- `HistoryView.tsx`: 100% lines, statements, branches and functions.
- `UseDialogFocus.ts`: 100% lines/statements/functions and 95.12% branches.
- `SettingsManager.ts`: 97.70% lines/statements, 96.05% branches and 100% functions.
- `GenerationExecutor.ts`: 94.93% lines/statements, 88.13% branches and 70.83% functions.
- `PublicWebProxy.ts`: 100% lines/statements, 89.28% branches and 66.66% functions.
- `ConversationNormalization.ts`: 100% lines, statements, branches and functions.
- `WebviewMessageValidation.ts`: 100% lines/statements/functions and 97.90% branches.
- `ApiSection.tsx`: 100% lines/statements/functions and 89.47% branches.
- `ContextCompaction.ts`: 99.36% lines/statements, 96.58% branches and 100% functions.
- `ReadFunction.ts`: 100% lines, statements, branches and functions.
- `SearchContent.ts`: 98.78% lines/statements, 97.54% branches and 93.33% functions.
- `PersistentChatState.ts`: 98.56% lines/statements, 93.79% branches and 100% functions.
- `ConversationWorkspaceReferences.ts`: 100% lines/statements/functions and 97.14% branches.
- `WebviewProvider.ts`: 99.54% lines/statements, 98.31% branches and 100% functions.
- `ToolCallCycle.ts`: 98.41% lines/statements, 94.73% branches and 100% functions.
- `Markdown.ts`: 100% lines, statements, branches and functions.
- `WorkspaceRestoreStore.ts`: 99.66% lines/statements, 95.76% branches and 100% functions.
- `ToolCallSession.ts`: 99.47% lines/statements, 92.66% branches and 100% functions.
- `Main.tsx` and `LegacyDraftAttachments.ts`: 100% lines, statements, branches and functions.
- `ExecutionStages.ts`: 98.30% lines/statements, 93.82% branches and 100% functions.
- `MessagesSection.tsx`: 96.69% lines/statements, 98.46% branches and 100% functions.
- `streaming/Streaming.ts`: 100% lines/statements/functions and 93.84% branches.
- Remaining global gaps: 310 lines, 890 branches and 8 functions. These remain
  visible for diagnosis; 100% is outside the revised essential scope.
- Combined-run memory peak: approximately 1053 MiB RSS. Assertion guards compare
  original operands and only bound failure diagnostics; watchdog and V8 heap caps
  protect the host without changing assertion outcomes.
- Strict per-file 100% gate: fails as expected on the remaining gaps.
- VS Code 1.144.0 integration: 35 passing. The undo failure was corrected by
  applying visible-document writes through `TextEditor.edit` with explicit undo
  stops. Tests cover two independent tool writes, undo/redo, preservation of
  pre-existing dirty text and unchanged disk contents, plus hidden-buffer edits
  without stealing focus. Focus-sensitive editor commands are executed in an
  isolated Xvfb display and wait for the expected document-change event.
- Persisted recovery regression verifies that the `before` copy contains the
  unsaved pre-tool buffer, survives reopening the store and restores that version
  after the tool result is saved. Recovery uses the independent copies under
  `snapshoots/<chat>/.snapshot/turns/<turn>/before`, not the older on-disk buffer.
- Dead-code audit: passing after removing unnecessary export keywords from
  integration helpers and the internal terminal parser; their behavior is unchanged.
  Test double entries are declared in knip because esbuild resolves them dynamically.

CI runs unit coverage and combined extension-host coverage on the platform matrix,
uploading `unit-coverage` and `extension-coverage` reports. The
strict 100% diagnostic remains available separately; it is not required by the
revised essential scope. CI report generation alone does not establish 100%.

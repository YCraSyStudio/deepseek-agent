# Change Log

Each release links to its extended notes in the [documentation](https://ycrasystudio.github.io/deepseek-agent/en/changelog/).

## [0.1.15] - 2026-09-13 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-15)

- **Added the `move_path` tool**: moves or renames a file or a whole directory inside the workspace, creating the destination's parent folder. It never overwrites, so an existing destination fails before anything is touched, and an optional `expectedBeforeHash` rejects the move if the source file changed after the preview.
- **Added the `delete_path` tool**: deletes a file or, with `recursive: true`, a directory and everything inside it. The path goes to the operating system trash unless `permanent: true` is passed, and `recursive` is never inferred: a directory without it fails instead of taking its contents with it.
- **Path changes decided from Git facts.** In the automatic permission modes, `move_path` and `delete_path` skip the security review when Git proves the change can be undone: the path is inside a repository, tracked, not ignored, and free of uncommitted changes. An untracked, ignored, modified, or non-repository path keeps the confirmation it had before, so a delete that cannot be undone is never treated as a routine workspace write.
- **DeepSeek V4 Pro is selectable again, with its images delegated to Flash.** The model registry records capability flags, so the extension knows V4 Pro cannot read images itself: a Pro generation that carries a live attachment is offered `analyze_images`, which asks Flash about the attachments named in the current message, sends DeepSeek file IDs instead of Base64 or local paths, disables thinking, caps its own output at 8K tokens, rejects expired files and files uploaded to another API origin, and reports the delegated usage against Flash in the `vision_analysis` phase. A Flash generation keeps reading images natively, in chat and in tool rounds.
- **The usage popover now shows the context window and can compact on demand.** It reports measured usage once a request has been sent and an estimate before that, with the window size, the soft and hard limits, the point where auto-compaction starts, and how many compactions the conversation has had; **Compact context** runs a manual compaction and reports the tokens it freed, or that there was nothing to compact.
- **Added the `low` reasoning effort**, between `off` and `high`, so thinking can be trimmed for speed without turning reasoning off.
- **Conversation history can be filtered and grouped by workspace**, with an `All workspaces` entry, a header per workspace, and the conversation count of each group.
- **Terminal results keep their full output viewable.** The row still shows a bounded preview, and a `View retained output` disclosure opens the stdout or stderr that was kept, so a command whose preview looks truncated can be inspected without running it again.
- **Tooltips are drawn by one portal layer.** `data-tooltip` anchors are rendered by `TooltipLayer`, which flips sides and aligns when the requested position has no room, so hints survive the panels that clip their children and the narrow sidebar; the composer pickers and `select` now share the same control metrics, so the model menu matches the permission select instead of carrying its own border and height.
- **Credentials are stripped from tool traffic.** Tool results, stored tool-call arguments, and the content handed back after a confirmation pass through redaction, which replaces credential-shaped keys and patterns with `[REDACTED]` before the text reaches the transcript, the tool ledger, or a checkpoint; structured output stays parseable, so the paths and results a tool consumer reads are unaffected.

## [0.1.14] - 2026-09-10 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-14)

- Moved to `deepseek-flash` (DeepSeek-V4.1-Flash) and removed the **DeepSeek V4 Pro** option, the `analyze_images` delegation tool, the hidden Vision-to-Flash fallback, and the retired-model compatibility map.
- Updated the cost catalog to the current rates with the documented peak/off-peak split, and let usage cost be displayed in USD or CNY.
- Fixed the largest avoidable cost of a long chat: a minute-precision timestamp in the system message invalidated DeepSeek's prefix cache on the first request of every generation.
- Reviewer guidance is appended as the newest message instead of being spliced into the system message, so a progress checkpoint or a completion recovery no longer re-bills the whole transcript as a cache miss. Both reviewers ignore that guidance when they read the user's request.
- The coding prompt now budgets code comments: intent that the code does not already state, never a restatement, and matching the file's existing density, since a comment costs output once and input on every later round that re-reads the file.
- The usage popover reports the conversation-wide total computed by the extension host instead of the messages the webview happens to hold.
- Auxiliary compaction uses per-phase output ceilings, the cache-hit ratio is shown per phase, and model capability flags nobody read were removed.
- A finished turn ends with an edited-files summary whose rows open the native change diff; reverting changes is out of scope.
- Pending `edit_file` and `apply_patch` previews no longer steal focus, including on macOS, where the platform activates the shown editor even when it is asked to preserve focus.
- Long conversations render lazily, with memoized message rows.
- Added the `list_workspace` tool; reasoning blocks render Markdown and collapse like the tool lists; fixed the tool-call chevron; attached images open a zoomable, draggable viewer; and the composer gained spacing above its toolbar.
- Added the `read_func` tool, which returns only the functions, methods, or types named in a source file, chained through their enclosing declarations, so reading one function no longer pulls the whole document into the context. Symbol ranges come from the editor's own language providers, so the tool follows the language instead of a text pattern. Module-level `const` bindings are resolvable, and an empty answer is believed only after the file has been loaded and the provider has repeated it across a short backoff.
- `read_file` reads a line range through `offset` and `limit`, the fallback for content the editor cannot name as a symbol: `search_content` locates the name and only those lines are read, with the range bounds, `hasMore`, and the whole-file hash.
- The prompt and both read tools state one reading order — `read_func` for a named declaration, `search_content` plus a `read_file` range for what the editor cannot name, and a whole-file read only for context spanning declarations — so every chat follows it instead of one conversation's habit.
- Safety decisions start from machine-verifiable facts, so a routine workspace edit or a finite diagnostic command runs without a review round; everything unproven still goes to the independent review.
- A second `incomplete` verdict from the completion reviewer keeps the delivered answer instead of replacing it with an error.

## [0.1.13] - 2026-09-09 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-13)

- Added the `compact_context` tool and raised the default output allowance to DeepSeek's documented 384K limit.
- Replaced the native workspace-reassign prompt with an in-webview Workspace Mismatch modal offering `Open here` or `Cancel`.
- `run_terminal_command` reuses one dedicated integrated terminal instead of closing it after every command.
- Fixed generation-event scoping and reworked the composer footer for narrow sidebars.

## [0.1.12] - 2026-08-28 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-12)

- Tool execution now depends exclusively on native API `tool_calls`; the DSML text detector, streaming buffer, hidden retry, and recovery prompt were removed.
- Split chat generation, history, settings, webview protocol, attachments, usage accounting, tool-call completion, and SearXNG installation into focused services.
- Removed obsolete compatibility shims and unused provider and FIM paths, hardened the SearXNG publication workflow, and added unused-code and Knip gates.
- Simplified the automatic interface-language option to `Auto`.

## [0.1.11] - 2026-08-27 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-11)

- Replaced Chromium-driven search with an extension-managed local SearXNG runtime that needs no system Python, Docker, Podman, or browser.
- Terminal commands run in a visible per-command integrated terminal; detached process launchers are rejected.
- Tool cycles continue to a real terminal condition, with progress reviews and duplicate-call suppression scoped to the workspace mutation epoch.
- Added a bounded completion review for premature stops, a conversation-level usage popover, and removal of legacy history and checkpoint compatibility.

## [0.1.10] - 2026-08-22 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-10)

- Simplified permissions to `default`, `auto-approve`, and `full-access`, with an independent DeepSeek review classifying mutations as routine, elevated, or critical.
- Replaced the non-visual Flash option with `DeepSeek V4 Vision (Flash)`, added the delegated `analyze_images` tool for Pro, and added a provider-local fallback to stable V4 Flash.
- Unified the textarea, model and reasoning picker, attachments, permission mode, and send actions into one composer.
- Rebuilt cancellation as a stable terminal outcome that preserves the prompt, partial timeline, and completed tool results.

## [0.1.9] - 2026-08-11 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-9)

- Isolated concurrent generations with conversation and generation correlation, navigation IDs, and snapshot-based restoration.
- Changed **Stop** to remove the cancelled turn atomically and restore its prompt as a draft, with idempotent cancellation propagated to descendants.
- Centralized terminal generation ownership and calibrated automatic compaction with safe rollover at the hard context limit.
- Kept Marketplace builds on the normal channel while the package retains `preview: true` and GitHub releases stay prereleases.

## [0.1.8] - 2026-08-08 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-8)

- Search opens the selected Bing, Google, or Baidu home page and types like a human; CAPTCHA, blocking, and timeouts are terminal.
- Search returns at most ten organic HTTPS URLs, and `read_web` accepts only a URL registered to its `search_id`.
- Rebuilt page extraction around `document.body` with numbered sections, opaque cursors, and a fresh cryptographic nonce around untrusted content.
- Added dedicated API and Web search Settings tabs and removed the visible-browser and usage-warning flows.

## [0.1.7] - 2026-08-07 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-7)

- Replaced the integrated-browser tools with an isolated `puppeteer-core` runtime and a pinned Chromium Headless Shell fallback.
- Added an ephemeral HTTPS-only proxy with DNS pinning, SSRF and rebinding protection, and request, transfer, and concurrency limits.
- Restricted the model to `search_web` and the multi-mode `read_web` and added web-tainted generation tracking for workspace mutations.
- Compacted completed conversation context to user and final-answer pairs.

## [0.1.6] - 2026-08-04 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-6)

- Added provider-reported token and cache observability per request phase, generation, and conversation, with a versioned USD catalog for official DeepSeek costs.
- Added Incognito mode as the privacy boundary for disabled history.
- Hardened tool-call integrity, unsaved buffers, concurrent storage, partial streams, process shutdown, protocol negotiation, and model validation.
- Added production CI and packaged-VSIX release gates with deterministic artifacts and checksums.

## [0.1.5] - 2026-07-30 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-5)

- Packaging hotfix: excluded `*.log` files from VSIX artifacts.

## [0.1.4] - 2026-07-30 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-4)

- Protected DeepSeek credentials per API origin in VS Code Secret Storage, with automatic legacy migration and redacted errors.
- Added the two-stage `auto-approve` gate: conservative local analysis first, then a bounded DeepSeek review for uncertain workspace-contained commands.
- Added reviewer outcomes for automatic approval, safe replanning, and manual confirmation, keeping credentials, elevation, external mutation, broad termination, and destructive operations non-delegable.
- Grouped reasoning and tool calls into expandable Activity panels and added native per-tool change diffs with `Open file` and `View change`.
- Reorganized contracts, tools, command review, chat orchestration, VS Code adapters, Settings, Chat UI, and tests by domain with enforced architecture boundaries.

## [0.1.3] - 2026-07-27 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-3)

- Added concurrent generations across conversations, per-conversation queues, targeted interruption, and atomic checkpoint recovery after restart.
- Bound conversations and tool execution to immutable logical workspaces with safe multi-root paths and hardened content search.
- Redesigned permissions around `default`, `read-only`, `auto-approve`, `full-access`, and editable `custom` profiles.
- Hardened terminal and filesystem execution with workspace containment and serialized mutations, and added automatic context compaction.

## [0.1.2] - 2026-07-23 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-2)

- Added the opt-in `auto-approve` permission mode and reorganized settings around a clearer General section.
- Added an explicit confirmation at the tool-call round limit and aligned the maximum output-token setting with DeepSeek's 384K limit.
- Fixed pending tool confirmations surviving cancellation and the active conversation identity being lost when history was updated.
- Added the in-repository technical wiki.

## [0.1.1] - 2026-07-17 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-1)

- Replaced text markers with a native chronological timeline for reasoning, content, and tool groups, and unified tool states.
- Added structured non-interactive terminal results with bounded output, process-tree cancellation, and platform-aware danger analysis.
- Moved settings and per-conversation history to `~/.yrs-dpsk-copilot/` with atomic writes, validation, quotas, pagination, bulk deletion, and Undo.
- Completed the accessible chat, confirmation, settings, and history flows with English, Spanish, and Chinese localization.
- Hardened SSE parsing, response validation, URL handling, timeouts, and bounded retries, and added multi-root association, staged Git context, and `AGENTS.md` limits.
- Refreshed the preview icon palette and fixed the Windows integration-test runner.

## [0.1.0] - 2026-07-12 [details](https://ycrasystudio.github.io/deepseek-agent/en/changelog/#v0-1-0)

- Initial preview release for the VS Code Marketplace.

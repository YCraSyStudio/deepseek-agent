[Back](INDEX.md)

# Settings, Secrets, and History

## Settings

`src/vscode/storage/SettingsManager.ts` atomically stores normalized general settings in `~/.ycrasy-agent/settings.json` and provider settings in `~/.ycrasy-agent/deepseek/settings.json`. Runtime reads use the confirmed in-memory revision. The old `~/.deepseek-agent/` contents migrate automatically on the first activation of the new version, after which the old directory is removed. Later starts skip migration when that directory is absent. See [Provider Storage](Provider-Storage.md) for migration and conflict handling.

`HistoryTransitionController` owns the two-phase persistent/incognito transition so configuration writes, pending-generation decisions, and save/discard outcomes remain ordered.

Current defaults and limits:

- models: `deepseek-v4-flash-vision-exp` (default) and `deepseek-v4-pro`.
- permission modes: `default`, `auto-approve`, and `full-access` only.
- Web search: enabled by default and represented by one capability toggle.
- output allowance: 8,192 tokens, clamped to 1–384,000.
- concurrent generations: 8, clamped to 1–16.
- history retention: 30 days by default.

API keys are never part of settings.

## User customization

Settings → Customization owns `includeHomeAgents`, disabled by default. Enabling it reveals **Open global AGENTS.md**. The host waits for confirmed settings, creates an empty `AGENTS.md` only if absent in the active data directory, and opens it in the VS Code text editor. Existing user content is never overwritten. Instruction loading shares the same path resolver and rereads saved instructions before each message across workspaces. Changing the configured storage folder takes effect after reload, as with other data.

Workspace instructions offers Generate AGENTS.md when the root file is missing, or Edit AGENTS.md when it already exists. Generation creates an editable template without contacting DeepSeek and opens it in VS Code; existing content is preserved. With multiple local folders, select the target workspace. The button updates when the file is created or deleted and works independently of global instructions. Instructions are reread from the saved workspace file before each message.

### Instructions

Customization → Instructions → Create instruction creates and opens an editable Markdown template, for example commit.md. Choose Global (instructions/ in the active data directory) or a workspace (instructions/ at its root), enter a file name and describe when to use it. The description is stored as frontmatter; use the body for the rules, such as commit language, fix:/feature: prefixes, ticket format and checks. Existing files are opened without being overwritten and can be edited from the list. DeepSeek receives only a bounded catalog of names, scopes and descriptions, then reads relevant full instructions through read_instruction before the task. Global entries work independently of the global AGENTS.md toggle; a workspace entry with the same name takes precedence for that workspace. Limits are 128 catalog entries and 64 KiB per file; symbolic links are not followed. These files are not included in the global AGENTS.md sync toggle.

Instructions offers three starter templates: Blank.md (an empty rules section), git.md (repository status, branch/merge workflow and checks), and commit.md (message language, fix:/feature: or [ticket] format, staged changes and checks). Choose a template before creating; Git and commit templates prefill the editable name and activation description. You can rename the file without changing its selected template. The template is written locally and opened in VS Code without a model call; existing files are never replaced. The creation request carries the validated template id (blank/git/commit); the host renders that template in the selected interface language rather than inferring it from the file name.

The instruction name field contains only the base name and displays a fixed .md suffix outside the editable input. Other extensions remain part of the base name: commit.txt creates commit.txt.md. Existing instructions are grouped into independent Global and Workspace collapsible lists, each with its entry count; workspace entries show the project name. Creation accepts a base name of up to 64 characters (letters, digits, dots, hyphens and underscores, starting with a letter or digit); the host appends .md without stripping any user-entered extension. Catalog discovery and read_instruction retain the complete base name in the id.

The host binds read_instruction to the generation’s captured workspace snapshot. The tool accepts exact catalog ids, never arbitrary paths. Local scope uses the root alias in workspace:<alias>:<name>; global scope uses global:<name>. Reading is a read-only tool and follows the selected permission mode. Optional catalog failures do not block chat. Empty/missing instruction folders add no prompt text. Catalogs refresh before each message; the settings list refreshes on save, file changes and workspace changes.


Type ./com in the chat composer to find matching workspace files and instructions. Suggestions are grouped into Files and Instructions; Instructions contains Workspace and Global subsections. Use the arrow keys and Enter/Tab or click to select. File and folder suggestions keep their existing behavior. Selecting an instruction inserts an unambiguous reference such as ./@instructions/global/commit.md or ./@instructions/workspace/project/commit.md. These are chat references, not disk paths. On send, the host validates the reference against the chat workspace, reads the current saved file and attaches its rules to that user turn; ordinary file references are not treated as instruction selections. Selected rules remain in the conversation context for continuations. You can select up to eight instructions, totaling at most 128 KiB. A deleted, stale or unavailable instruction must be selected again. The virtual @instructions namespace prevents ambiguity with real workspace paths. Completion results are bound to the chat revision; an empty workspace can still offer global instructions, while disconnected/changed workspaces cannot return stale entries. Instruction references are ordinary text in the draft/send/steer payload, so no extra client-supplied file contents or ids are trusted. Only catalog ids resolved through captured instruction roots reach file reads. The hidden contextContent stores the selected content while the displayed message keeps the reference.

## Local settings and instructions

Extension settings and global AGENTS.md remain in the selected data directory. There are no VS Code account sync controls, background reconciliation or sync setup prompts. Activation calls `globalState.setKeysForSync([])` to retire registrations from earlier versions. Previously stored local settings and instruction files remain intact; obsolete sync preference keys are ignored and omitted when settings are saved.

## Secrets

`SecretsManager` stores credentials per normalized API origin in VS Code Secret Storage. The webview receives only configured/missing state and a masked placeholder. Keys must never enter settings, history, checkpoints, diagnostics, URLs, logs, or visible errors. Redirects must preserve the selected credential origin.

## Conversation history

Every content or attachment mutation advances the conversation timestamp, including hidden workspace reminders and selected instructions. Equal-timestamp differences still trigger the cross-window conflict check. The webview retains a submitted draft until the persisted user message is published; preparation failures before that leave the text editable and recoverable.

`HistoryManager` coordinates retention and mutation locking. `ConversationStorage` owns manifests and bounded segments, while `ConversationNormalization` produces the canonical schema-v2 representation. Data lives under `~/.ycrasy-agent/history/`. Conversations include immutable workspace binding, generation ownership, terminal status, timeline, tool presentation, and image attachment metadata.

Terminal generation statuses are `completed`, `cancelled`, `interrupted`, and `error`. Explicit Stop persists a `cancelled` turn with its user message, partial assistant timeline, and completed tool results. Only complete provider protocol sequences are eligible for future replay.

History is limited by retention and quota and excludes the active conversation from silent cleanup. Activation accepts only schema-v2 conversations; incompatible files and their segments are permanently deleted rather than migrated or quarantined. Disabling history enters Incognito mode: active data stays in memory and reaches history only through an explicit save transition.

## Workspace snapshots and revert

Each chat mirrors relevant source files directly into `~/.ycrasy-agent/snapshoots/<chat-id>/` (under the configured data root when customized). There is no extra `workspace/` folder. Multiple roots use their aliases as subdirectories. These are independent file copies, never hard links to live source files; reflink copying is used when supported.

File enumeration respects each repository’s Git ignore rules even when the workspace root is a plain parent directory containing independent repositories. Embedded repositories, initialized submodules and worktrees with a `.git` file are enumerated through their own Git index and ignore configuration. Eligible tracked and untracked source files count toward the 50,000-file limit; ignored build artifacts and temporary outputs do not. Non-Git directories retain generated-file exclusions.

Before a message, the extension compares the previous state and captures a real pre-turn copy. After the turn (including cancellation/error), it updates the mirror and retains before/after copies only for changed paths under `.snapshot/turns/<generation-id>/`. Unchanged turns retain no historic copy. Auxiliary JSON stores identities and fingerprints; source bytes live in actual files. The last observed state generates a bounded reminder of external changes before subsequent messages, without resending the editor or Git diffs. Reminders survive replay and context compaction.

The response summary exposes **Review changes** and **Revert turn**, including changes made through terminal commands. Review opens saved before/after documents in VS Code with a **Revert Turn** editor action. The `revert_workspace` tool invokes the same restore operation through normal tool permissions; omitting the generation id selects the latest unreverted completed turn.

Restoration verifies the original workspace, every recovery copy, and current affected files before writing. It restores pre-existing uncommitted edits, removes files created during the turn, and recovers deleted or binary files. Affected files changed later, dirty editors, untrusted workspaces, symlink parent escapes, or active/queued generations reject restoration. Other paths, Git commits and the staging index remain untouched. Snapshots are removed with chat deletion or history retention. Incognito keeps fingerprint comparisons in memory only; disk restoration is unavailable.

### Storage and scope

- Git supplies tracked and non-ignored untracked paths. Dependency/cache directories are excluded even when accidentally tracked.
- `node_modules`, virtual environments, framework caches and `.git` are excluded. .NET `bin/obj` are excluded next to `.csproj`, `.fsproj` or `.vbproj`; web `dist/build/out` next to `package.json`; `target` next to Cargo/Maven projects. Source directories named `bin` are retained.
- Capture supports at most 50,000 paths and has a 15-second time budget. Virtual workspaces are unsupported. Symlink targets are not traversed, and the data directory itself is excluded. Unsaved existing editor contents are captured; editors must be saved before a restore.
- **General settings → Snapshot storage limit (MiB)** sets a shared quota across every chat, default **1024 MiB**, range 64–65536. Preflight includes temporary copies and mirror replacement, and conservatively counts logical sizes even when files share reflink blocks. At least **100 MiB** free disk space is reserved. Capacity checks and copying are serialized across chats.
- Insufficient quota, free space or a failed copy **does not block the message**. A visible warning explains that the turn cannot be reverted; previous complete backups are preserved. Incomplete staging is cleaned after failures. Existing recovery copies are not automatically evicted.

## Image attachments

- Image metadata stores the DeepSeek `fileId`, media type, byte size, origin, upload and expiry times, API origin, and local cache filename.
- Raw Base64 is never persisted. Clipboard Base64 is only a bounded transient protocol payload.
- Preview bytes live under the extension's `globalStorage/image-attachments` area, not in the conversation JSON.
- Picker uploads allow up to eight JPEG, PNG, GIF, or WebP images per message and 64 MiB per image. Clipboard IPC is limited to 16 MiB per image.
- Uploads use DeepSeek Files API `purpose=user_data` with a 30-day expiry.
- Removing a draft attachment attempts remote deletion and clears its preview cache.
- Conversation deletion defers attachment cleanup until the Undo window closes. Undo therefore restores both the conversation and its image previews.

## Generation checkpoints

`GenerationCheckpointStore` keeps one atomic schema-3 checkpoint per conversation at `~/.ycrasy-agent/history/<chat-id>/checkpoint.json`.

- Streaming writes are coalesced; queue and tool transitions persist immediately.
- Checkpoints contain partial presentation state, canonical transcript, queued prompts, image metadata, non-secret configuration, workspace binding, permission snapshot, and a monotonic revision.
- A checkpoint is limited to 16 MiB and is compacted before failing visibly.
- Host shutdown restores partial work as `interrupted`, unfinished tools as `cancelled`, and queued prompts as recoverable drafts.
- Explicit user cancellation is a persisted conversation outcome, not a recoverable cancelled draft.
- Completing or deleting a conversation removes its checkpoint; anything other than a valid schema-3 record is deleted during recovery.

- On startup, migrate the old generation-checkpoints directory only while it exists, following the legacy runtime cleanup pattern. Conflicts preserve both files and are logged for retry; matching copies resume safely after interruption. Remove the old directory only when empty, and leave unrelated files intact. History readers preserve checkpoint-only folders before the first persisted message and ignore checkpoint.json when reading conversation chunks.

[Back](INDEX.md)


## Unsent drafts

Drafts are stored under ~/.ycrasy-agent/history/<chat-id>/draft/, or history/new-chat-draft/ before the first message creates a conversation. Each folder contains draft.json and original image files. Sending removes the submitted draft; assigning a conversation ID removes the provisional new-chat folder while preserving any newly edited draft. Empty drafts and deleted conversations leave no draft folder. Existing webview drafts migrate when opened. The configured data directory replaces ~/.ycrasy-agent when customized. These files are local and are not part of VS Code Settings Sync. Native host requests serialize writes; binary images are saved separately and are not rewritten on each text edit. Incognito mode rejects draft reads and writes. History readers ignore draft subdirectories and the provisional new-chat-draft folder.

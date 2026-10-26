import type { PageContent } from "../Types";

export const userManual: PageContent = {
  navTitle: "User manual",
  title: "User manual",
  seoTitle: "User manual: chat, tools, permissions",
  description: "Install the extension, add an API key, and use chat, images, permissions, workspace tools, terminal, context, and global history.",
  lead: "Configure the API key, choose a permission mode, then use DeepSeek from the sidebar with explicit control over every workspace operation.",
  sections: [
    {
      title: "Getting started",
      items: [
        "Store generation recovery checkpoints at history/<chat-id>/checkpoint.json beside the conversation and draft. On startup, migrate generation-checkpoints only while it exists, preserve conflicting destinations, resume already-copied files and remove the legacy directory only when empty. Completing or deleting a generation removes its checkpoint without removing the conversation or draft.",
        "Drafts are stored under ~/.ycrasy-agent/history/<chat-id>/draft/, or history/new-chat-draft/ before the first message creates a conversation. Each folder contains draft.json and original image files. Sending removes the submitted draft; assigning a conversation ID removes the provisional new-chat folder while preserving any newly edited draft. Empty drafts and deleted conversations leave no draft folder. Existing webview drafts migrate when opened.",
        "Keep an independent unsent draft for each conversation and for New chat, restoring text, referenced files and image attachments when switching. Pasted images and external file snapshots are stored locally per chat and survive window reloads. Original image files are restored without uploading them to DeepSeek until submission. The draft clears only after its saved user message is displayed, and deleting a conversation removes only its saved draft.",
        "Open YCraSy DeepSeek Agent from the Activity Bar and enter the API key in Settings. Credentials are stored per normalized API origin in VS Code Secret Storage; reopening Settings shows only a masked placeholder preview.",
        "Choose thinking mode, reasoning effort, output allowance, and concurrent generation limit. Chat runs on DeepSeek V4.1 Flash with a 1M-token total context and 384K maximum output; the output allowance defaults to 384,000 tokens. Concurrency defaults to 8 and accepts values from 1 to 16.",
        "Type ./ to autocomplete safe workspace paths. Parent traversal with ../ is never accepted. In multi-root workspaces, paths begin with a stable alias such as ./frontend/src/App.tsx.",
        "Use the single + attachment action or Explorer/editor commands for explicit context. Ordinary external files become bounded, read-only snapshots; images are uploaded to DeepSeek after their binary signature is verified.",
        "Use Stop generation to cancel the current request and any running terminal process tree. The submitted prompt, partial assistant timeline, and completed tool results remain in history as a terminal cancelled turn; completed side effects are not rolled back.",
      ],
    },
    {
      title: "Images and vision",
      items: [
        "analyze_images is available only with DeepSeek V4 Pro, which delegates visual analysis to Flash. Flash has no access to that tool and reads images directly when they are included in its visual context. A local screenshot id alone does not provide image content; new local captures are not yet inserted automatically into Flash context.",
        "The same picker accepts context files and up to eight JPEG, PNG, GIF, or WebP images. Images can also be pasted with Ctrl+V or Cmd+V; clipboard images are limited to 16 MiB and picker images to DeepSeek's 64 MiB limit.",
        "DeepSeek V4.1 Flash receives DeepSeek file IDs directly, so the current prompt's images are read in the same generation as its text.",
        "A provider failure is surfaced as-is: the extension never silently retries, drops already-sent image references, or rewrites the model name to make a failed image request look successful.",
        "Uploads use the DeepSeek Files API with purpose user_data and a 30-day expiry. Base64 is transient clipboard IPC only and is never stored in history or sent inside provider messages.",
        "Removing a draft image attempts local and remote deletion. Permanent conversation deletion cleans image resources only after the Undo window closes.",
        "Clicking an attached image, a composer thumbnail or an image of a sent message, opens a full-window viewer. It fits the image to the window by default, keeps its aspect ratio, and lets a zoomed image be dragged to pan instead of being squashed. It offers zoom out, the fit percentage (click to fit), zoom in, and close, and also handles Escape, the backdrop, and the +, -, and 0 keys.",
      ],
    },
    {
      title: "Concurrent generations and queues",
      items: [
        "Only one generation runs at a time in each conversation. Additional prompts in that conversation are queued in submission order.",
        "Different conversations can generate concurrently up to the configured global limit.",
        "While a response is active, one button shows Stop when the draft is empty and Guide when it has content. Enter restarts the transport and continues the same task under the new guidance; holding Ctrl changes the button to Queue, and Ctrl+Enter appends an independent draft after the active response. Shift+Enter inserts a newline.",
        "Switching conversations or recreating the webview does not transfer stream or tool events between runs; every event is bound to its generation and conversation.",
        "If VS Code closes, partial output is restored as interrupted, unfinished tools become cancelled, and queued prompts are offered as recoverable drafts on the next activation.",
      ],
    },
    {
      title: "Permissions and tool states",
      items: [
        "default asks before every tool; auto-approve runs routine operations automatically anywhere and confirms elevated or critical actions; full-access runs routine and elevated operations anywhere and confirms only critical actions that could make the computer unusable or cause broad irreversible loss.",
        "There is no per-tool permission matrix. The Web search switch removes search_web and read_web from model requests when disabled. Workspace binding and VS Code Workspace Trust remain enforced.",
        "Tool calls move through awaiting confirmation, running, and one terminal state: completed, rejected, cancelled, or error.",
        "The extension host acknowledges execute and reject actions before the webview commits the visible state.",
        "Tool calls in a round run sequentially. Identical calls are skipped until a workspace mutation makes a legitimate repeat useful. Tool cycles have no configurable round or per-block call limit; an independent reviewer checks progress after 20 completed rounds and every five rounds thereafter without disabling tools.",
        "Read-only tools may run across concurrent conversations, while file and terminal mutations are serialized within the same workspace.",
      ],
    },
    {
      title: "Activity and file results",
      items: [
        "Adjacent reasoning and tool calls are collapsed into an Activity panel by default. Expand it to inspect individual reasoning steps, tool states, arguments, and relevant results.",
        "Conversation usage appears in a compact popover beside the permission selector, including per-model totals after model switches. If some DeepSeek requests omit usage, available reported requests still produce an explicitly marked lower-bound cost.",
        "A successful read_file call does not duplicate the file body in Chat. Use Open file to inspect it in the editor; failed reads still show their diagnostic result.",
        "Completed create_file, edit_file, and apply_patch calls expose View change when a complete diff is available. It opens the before and after content recorded for that specific tool execution, independent of later working-tree changes.",
        "A finished turn ends with the edited-files summary: one row per written file with its additions and deletions, Show N more files beyond the first three, and Review to open every change of the turn. The host records the exact before and after contents for the session, so a large change still opens completely even though the diff stored in the tool result is bounded for the model context. Reverting an applied change is not implemented yet.",
        "Usage cost can be displayed in US dollars or Chinese yuan from Settings → Usage & cost. Each currency uses DeepSeek's own published price table, so no exchange rate is invented; persisted totals stay canonical in USD and are repriced for display.",
      ],
    },
    {
      title: "Long conversations",
      items: [
        "A long transcript is not mounted whole. Only the newest 40 messages render on open, plus every history page the user loaded from disk; Show N earlier messages reveals 40 more of whatever is already in memory and keeps the message being read in place instead of jumping.",
        "Tool-call reconciliation, usage totals, draft persistence, and history paging keep working on the full loaded conversation; only the rendered list is windowed, and memoized rows keep typing a draft responsive.",
      ],
    },
    {
      title: "Workspace overview",
      items: [
        "list_workspace renders the whole project as one indented tree in a single call, so a new chat does not have to chain list_directory calls. Hidden entries are included, and a folder that holds too much content is summarized as ... instead of being dumped or silently excluded.",
        "Its optional path argument scopes the tree to one workspace folder. It reads at most 300 folders and stops after 400 entries or 48 KiB, summarizing a folder instead of listing it when it holds more than 25 entries, or 60 at the workspace root, or when its subtree does not fit the remaining line budget.",
      ],
    },
    {
      title: "Workspace content search",
      items: [
        "search_content matches literal text case-insensitively through the VS Code workspace filesystem; it does not run a shell or treat the query as a regular expression. The query must contain text and is limited to 4,096 characters.",
        "Its optional filePattern is a workspace-relative glob such as *.ts or src/**/*.md. It defaults to **/*, is limited to 1,024 characters, and rejects absolute paths and parent traversal.",
        "Sensitive paths, binary files, and files larger than 2 MiB are skipped. Sensitive files are filtered before their contents are read.",
        "A search considers at most 10,000 files and returns at most 50 matches. Result lines and total output are bounded, and the response reports scanned and skipped files plus whether it was truncated.",
        "Search stops when the request is cancelled and times out after 15 seconds.",
      ],
    },
    {
      title: "Optional beta features",
      items: [
        "In Settings → API, Enable DeepSeek beta features is off by default. Enabling adds the agent’s complete_code tool for assistant-prefix completion and FIM (fill in the middle), and enables strict function schemas. A caller-supplied reasoning prefix is supported with Chat Prefix Completion when thinking is enabled.",
        "Ask the agent to fill a missing function body with FIM, or continue a specified response prefix. The tool returns text and does not edit files; normal edit tools retain their permissions. The agent tool remains on demand. Separate Editor suggestions and Chat suggestions switches enable gray text (Tab accepts, Escape dismisses). Editor suggestions use FIM after a typing pause. Chat suggestions are requested only with Suggest message beside the context indicator: generate a prompt from an empty draft or continue existing text. Click again to cancel; typing never requests a suggestion.",
        "Calls use the same API origin and credential with the beta path, default to 1,024 output tokens, and are capped at 4,096 or the lower configured output limit. Usage appears under Beta code completion. Disabling blocks new beta calls and switches subsequent tool rounds to stable chat; already-running requests can finish. Enabling makes the tool available to new generations.",
        "Right-click a code editor → YCraSy DeepSeek Agent → Complete or Refactor. A selection takes priority; a blank line targets the whole file; otherwise the innermost enclosing symbol is used, with a statement/line fallback. Review the diff and choose Apply or Discard. Edits support undo and refuse to overwrite a changed document. Complete requires beta; Refactor uses the stable API.",
        "Editor suggestions send bounded nearby code. Chat suggestions send the draft with brief project metadata (folder names, top-level entries and package.json name/description), without source contents or chat history, and run only when requested using the composer button. Suggestions run without thinking, with 256/96 output tokens and cancellation/caching. API charges apply; interactive usage is shown in the DeepSeek status-bar tooltip separately from conversation usage. Automatic suggestions require workspace trust and exclude sensitive file names. Disabling beta stops interactive requests.",
      ],
    },
    {
      title: "Privacy",
      items: [
        "Settings → General → Privacy enables best-effort metadata minimization by default: generated runtime notices omit absolute workspace roots, optional user IDs and image filenames are not sent, and timestamps use UTC without a named local time zone. Relative paths and tool references remain when required. Messages, code, tool output, image contents/embedded metadata and existing history are not anonymized. This does not guarantee anonymity or GDPR compliance. No usage telemetry is collected; the API provider still receives the data needed to answer and the connection source IP.",
      ],
    },
    {
      title: "Web UI captures",
      items: [
        "Web reads and screenshots use an installed Chrome, Chromium, Edge, Brave or Vivaldi on the extension host. The extension starts its own headless process with a temporary profile and never opens your personal browser session. Capture permission remains controlled in Settings → Tools.",
        "If no supported browser is found, Chrome Headless Shell is downloaded from Google’s Chrome for Testing distribution into VS Code extension global storage, outside the VSIX. Initial installation needs network access and several hundred MB of disk space. While in use, stable updates are checked at most once a day; failed updates retain the installed version. The current and previous managed releases are retained. User-installed browsers are never updated.",
        "In remote workspaces, the browser runs on the extension host. Linux requires Chromium shared libraries and a working sandbox; the extension does not install system packages or disable sandboxing. Managed downloads support Windows x86/x64, macOS Intel/Apple Silicon and Linux x64. Linux ARM hosts need a system Chromium browser.",
      ],
    },
    {
      title: "Native window captures",
      items: [
        "Wayland window captures apply the valid pixel rectangle supplied by PipeWire before saving the PNG. This removes compositor padding around a smaller window without scaling it or trimming intentional black application content. Invalid crop rectangles are rejected. The GStreamer videocrop plugin is required alongside pipewiresrc, videoconvert and pngenc; it is included in gstreamer1.0-plugins-good on Ubuntu.",
        "On Wayland, window/debug capture opens the desktop system selector for each image. Choose the application window you intend to test. The extension reads one PNG frame through XDG ScreenCast/PipeWire and closes the sharing session immediately afterward. The portal does not expose title/PID matching, so results identify a user-selected window without claiming its identity. A cancelled or failed window selection never falls back to a whole monitor; whole-display requests still require explicit confirmation.",
        "The extension host needs a ScreenCast portal v3+ with window support, system /usr/bin/python3 with PyGObject/Gio/GStreamer, and the pipewiresrc, videoconvert and pngenc plugins. On Ubuntu these are provided by python3-gi, gir1.2-gstreamer-1.0, gstreamer1.0-pipewire, gstreamer1.0-plugins-base and gstreamer1.0-plugins-good. Dependencies are not downloaded or installed automatically. X11, Windows and macOS retain their platform-specific capture backends. Portal choices are not reused for automatic captures.",
      ],
    },
    {
      title: "Web search",
      items: [
        "Web search uses DeepSeek Search with the API credential saved for the configured origin. Page reads and web screenshots use an installed Chromium browser, or an automatically downloaded and updated Chrome Headless Shell. No personal browser profile is opened.",
        "Search is optimized for development: prefer documentation for the project’s versions, upstream repositories and relevant issue discussions. It requests eight results by default, supports up to 50, and exposes available relevance, authority and date metadata in bounded output. Queries and operators must fit 128 Unicode characters. English technical sources remain available unless you explicitly restrict language.",
        "read_web reuses available Search content or earlier reads in the current generation, otherwise it renders the authorized public HTTPS page locally. Only URLs returned by the current generation’s search or explicitly supplied by you are accepted. Returned sections remain bounded and untrusted.",
        "In Settings → Tools, search defaults to Global. Choose Automatic to use the country in your local system locale, or choose a country code such as ES. You can request another country or worldwide research in chat. This is a soft relevance preference and does not guarantee geographic ranking. System region is not physical geolocation. No IP lookup is performed and no IP address is added to search parameters; the API provider still sees the normal connection source address.",
        "Search requests are billed separately from model tokens; local page reads do not call the paid Fetch endpoint. Search request charges are not included in the token usage popover. Check the official pricing for current rates.",
      ],
    },
    {
      title: "Terminal execution",
      items: [
        "For native UI or a local server that must remain open during a capture, DeepSeek uses application_session: start launches a foreground command and returns a sessionId while it keeps running; status returns bounded startup output; stop closes that session. Tools execute sequentially, so a timed run_terminal_command preview would block the capture until the app exits. Build first, start the application, capture, then stop it. Running does not prove the UI is ready or visually correct. These sessions use the host system shell and appear in tool activity without opening another terminal tab. Preview hosts that monitor stdin remain connected until shutdown. Sessions are isolated by turn/chat, limited to three concurrent applications and eight launches per turn, and closed after ten minutes or at turn completion, cancellation, chat deletion or extension shutdown. Launches follow normal command review and workspace permissions.",
        "Each agent command runs non-interactively and visibly in a VS Code integrated terminal through Shell Integration. A chat reuses one terminal across working-directory changes, retaining its scrollback. Git and default pagers are disabled so commands cannot pause in a pager waiting for keys. Deleting a chat closes its terminal, even when that chat is not selected, without affecting other chats or manually opened terminals. Agent terminals also close on timeout, cancellation or extension shutdown, and are not restored after editor reloads/restarts. Captured results remain in the chat while the conversation exists.",
        "The result records bounded stdout/stderr, exit code, signal, timeout, cancellation, effective working directory, and shell.",
        "Output is bounded; when truncated, the beginning and end are retained and the omitted middle is marked.",
        "Detached and background process launchers are rejected. Agent terminals disable .NET build-server and node reuse so completed builds do not leave orphaned workers or locked project files.",
        "In automatic modes, terminal commands and file mutations are classified by a separate DeepSeek instance as routine, elevated, or critical; there is no local danger analyzer.",
        "The reviewer receives the initial user request, a content-free action description, mechanical scope facts, and bounded non-sensitive context from explicitly named workspace files.",
        "The reviewer may approve, return constraints for safer replanning, or request manual confirmation. Auto-approve confirms elevated and critical actions; full-access confirms critical actions. Automatic decisions require medium-high confidence or above.",
      ],
    },
    {
      title: "History and privacy",
      items: [
        "General settings are stored in ~/.ycrasy-agent/settings.json and DeepSeek settings in ~/.ycrasy-agent/deepseek/settings.json. Settings → General → Storage lets you type a data folder or select one, then apply it after reloading VS Code. Default restores .ycrasy-agent in your home directory on Linux/macOS or %USERPROFILE% on Windows. Existing data stays in its original folder. API credentials remain in VS Code Secret Storage, isolated by normalized origin, and are never included in WebviewConfig, history, or checkpoints.",
        "Automatically remove the obsolete runtimes/ and runtime-state/ directories in full on activation, before migrating the old data directory. Settings, history, snapshots and instructions remain intact. No standalone cleanup script remains; missing directories are skipped and failed cleanup is retried on a later start.",
        "History is stored globally under ~/.ycrasy-agent/history/ and each entry shows its source workspace. The first activation after upgrading automatically moves the old ~/.deepseek-agent/ contents into the new root and removes the empty old directory; conflicting destination data is preserved and reported.",
        "History can be disabled and retention can be configured from 0 days (manual deletion only) to 3650 days. The default is 30 days.",
        "Disabling history enters Incognito mode. Active generations and queued prompts require confirmation before they are stopped and cleared. Incognito chats stay only in memory, survive navigation between Chat, History, and Settings, and are discarded when the extension or VS Code reloads. When leaving, the current chat can be explicitly saved as a new conversation or discarded.",
        "The history list is rebuilt directly from validated conversation files. Storage is capped at 100 conversations and 24 MiB.",
        "Deleting one conversation or all visible conversations uses a native VS Code confirmation and offers Undo. Deletion first cancels active work and clears its queue/checkpoint; image cleanup waits until Undo expires so restoration remains complete.",
        "Conversation files must use schema version 2 with a complete workspace binding and current context summaries; each conversation lives in history/<id>/ as a manifest plus auto-incremented message chunk files. On activation, every incompatible, malformed, oversized, or inconsistently numbered conversation is permanently deleted, including legacy flat history files and the obsolete .segments directory; incompatible conversation formats are not migrated.",
        "Active work is checkpointed without the API key at ~/.ycrasy-agent/history/<chat-id>/checkpoint.json. Interrupted pending or running tools are restored as cancelled; only schema-3 checkpoints with a complete workspace binding are recovered, and incompatible records are deleted.",
      ],
    },
    {
      title: "Workspace context",
      items: [
        "Each chat keeps real recovery copies directly in ~/.ycrasy-agent/snapshoots/<chat-id>/, without a workspace subfolder. Auxiliary metadata and before/after versions for changed turns live in the hidden .snapshot/ directory. Before each message, external changes generate a brief reminder; after the turn, the copy is updated without resending the active editor or Git diffs.",
        "Use Review changes and Revert turn below a response or Revert Turn in the saved diff editor. You can also ask DeepSeek to undo its last turn with revert_workspace. Restoration preserves pre-existing edits and rejects later changes or dirty editors; it does not reset Git commits or the index. Incognito has memory-only change detection and no disk recovery copies.",
        "The total snapshot quota defaults to 1024 MiB and can be changed in General settings. At least 100 MiB of free disk space is reserved. If space is insufficient, the message continues with a visible warning that the turn cannot be reverted, preserving older copies. Git ignored files are excluded per repository even when the workspace is a parent folder containing multiple projects, including Git worktrees and submodules. The 50,000-file limit counts only eligible recovery paths. node_modules and generated project artifacts are excluded: .NET bin/obj, web dist/build/out and Rust/Java target. Ordinary source bin directories are retained. Deleting a chat removes its snapshots.",
        "Referenced files and AGENTS.md instructions are size-limited, use workspace-relative labels, and are delimited as untrusted data.",
        "Settings → Customization contains Use global AGENTS.md instructions. Enabling it reveals Open global AGENTS.md, which creates the file if missing and opens its source in VS Code. It uses AGENTS.md in the active data folder (default ~/.ycrasy-agent/), preserves existing content, and applies saved edits to subsequent messages in every workspace.",
        "Workspace instructions offers Generate AGENTS.md when the root file is missing, or Edit AGENTS.md when it already exists. Generation creates an editable template without contacting DeepSeek and opens it in VS Code; existing content is preserved. With multiple local folders, select the target workspace. The button updates when the file is created or deleted and works independently of global instructions.",
        "Customization → Instructions → Create instruction creates and opens an editable Markdown template, for example commit.md. Choose Global (instructions/ in the active data directory) or a workspace (instructions/ at its root), enter a file name and describe when to use it. The description is stored as frontmatter; use the body for the rules, such as commit language, fix:/feature: prefixes, ticket format and checks. Existing files are opened without being overwritten and can be edited from the list. DeepSeek receives only a bounded catalog of names, scopes and descriptions, then reads relevant full instructions through read_instruction before the task. Global entries work independently of the global AGENTS.md toggle; a workspace entry with the same name takes precedence for that workspace. Limits are 128 catalog entries and 64 KiB per file; symbolic links are not followed.",
        "Instructions offers three starter templates: Blank.md (an empty rules section), git.md (repository status, branch/merge workflow and checks), and commit.md (message language, fix:/feature: or [ticket] format, staged changes and checks). Choose a template before creating; Git and commit templates prefill the editable name and activation description. You can rename the file without changing its selected template. The template is written locally and opened in VS Code without a model call; existing files are never replaced.",
        "The instruction name field contains only the base name and displays a fixed .md suffix outside the editable input. Other extensions remain part of the base name: commit.txt creates commit.txt.md. Existing instructions are grouped into independent Global and Workspace collapsible lists, each with its entry count; workspace entries show the project name.",
        "Type ./com in the chat composer to find matching workspace files and instructions. Suggestions are grouped into Files and Instructions; Instructions contains Workspace and Global subsections. Use the arrow keys and Enter/Tab or click to select. File and folder suggestions keep their existing behavior. Selecting an instruction inserts an unambiguous reference such as ./@instructions/global/commit.md or ./@instructions/workspace/project/commit.md. These are chat references, not disk paths. On send, the host validates the reference against the chat workspace, reads the current saved file and attaches its rules to that user turn; ordinary file references are not treated as instruction selections. Selected rules remain in the conversation context for continuations. You can select up to eight instructions, totaling at most 128 KiB. A deleted, stale or unavailable instruction must be selected again.",
        "Extension settings and global AGENTS.md remain in the selected local data directory. They are not synchronized through the VS Code account. Global and workspace instruction files remain editable from Customization.",
        "The total request budget includes system prompts, tool schemas, history, references, output allowance, and safety margin. Complete older generations are summarized atomically; large files are reduced to literal relevant line ranges. Tool arguments, required reasoning, and active tool cycles are never truncated.",
        "Choose the model and permission mode from the chat controls. Use Review Changes from the editor context menu or Source Control to attach the Git diff for review, and start a fresh conversation with the + button.",
      ],
    },
  ],
};

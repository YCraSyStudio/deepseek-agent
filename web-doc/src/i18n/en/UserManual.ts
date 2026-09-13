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
      title: "Web search",
      items: [
        "When Web search is enabled, the default http://127.0.0.1:8888 endpoint is managed by the extension. The first start downloads the pinned SearXNG runtime for the current platform, verifies its expected size and SHA-256 digest, and runs it only on loopback without requiring system Python, Docker, Podman, or Chromium.",
        "Settings loads the configured instance's engine catalog. Leaving the selection automatic uses the instance defaults; selecting engines sends their validated shortcuts with each search.",
        "A compatible custom SearXNG endpoint can be configured. Non-loopback endpoints must use HTTPS, and URLs containing credentials are rejected.",
        "search_web returns up to ten normalized HTTPS results. read_web accepts only a URL registered by that search or explicitly supplied by the user, then extracts bounded inert page sections.",
      ],
    },
    {
      title: "Terminal execution",
      items: [
        "Each agent command runs non-interactively and visibly in a dedicated VS Code integrated terminal through Shell Integration. The same terminal is reused for later commands so its scrollback and history stay visible, and it is closed only on timeout, cancellation, a working-directory mismatch, or extension shutdown, while the captured result remains in Chat.",
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
        "Settings are stored in ~/.deepseek-agent/settings.json. API credentials remain in VS Code Secret Storage, isolated by normalized origin, and are never included in WebviewConfig, history, or checkpoints.",
        "History is stored globally as one JSON file per conversation in ~/.deepseek-agent/history/ and each entry shows its source workspace.",
        "History can be disabled and retention can be configured from 0 days (manual deletion only) to 3650 days. The default is 30 days.",
        "Disabling history enters Incognito mode. Active generations and queued prompts require confirmation before they are stopped and cleared. Incognito chats stay only in memory, survive navigation between Chat, History, and Settings, and are discarded when the extension or VS Code reloads. When leaving, the current chat can be explicitly saved as a new conversation or discarded.",
        "The history list is rebuilt directly from validated conversation files. Storage is capped at 100 conversations and 24 MiB.",
        "Deleting one conversation or all visible conversations uses a native VS Code confirmation and offers Undo. Deletion first cancels active work and clears its queue/checkpoint; image cleanup waits until Undo expires so restoration remains complete.",
        "Conversation files must use schema version 2 with a complete workspace binding and current context summaries. On activation, every incompatible, malformed, oversized, or mismatched history file is permanently deleted together with its message segments; no legacy migration is attempted.",
        "Active work is checkpointed without the API key under ~/.deepseek-agent/generation-checkpoints/. Interrupted pending or running tools are restored as cancelled; only schema-3 checkpoints with a complete workspace binding are recovered, and incompatible records are deleted.",
      ],
    },
    {
      title: "Context and slash commands",
      items: [
        "Auto context includes the active editor plus staged and unstaged Git changes with time and size limits.",
        "Referenced files and AGENTS.md instructions are size-limited, use workspace-relative labels, and are delimited as untrusted data.",
        "The total request budget includes system prompts, tool schemas, history, references, output allowance, and safety margin. Complete older generations are summarized atomically; large files are reduced to literal relevant line ranges. Tool arguments, required reasoning, and active tool cycles are never truncated.",
        "Use /context to inspect what a normal request would send. Other commands include /status, /tools, /mode, /auto-context, /review, /goal, /summarize, and /clear-context.",
      ],
    },
  ],
};

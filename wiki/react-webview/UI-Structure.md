[Back](INDEX.md)

# UI Structure

## Views

`ChatView` renders messages, chronological streaming, Activity groups, image previews, path autocomplete, tool confirmations, queues, steering, and targeted Stop.

The composer is one rounded container modeled after a compact coding-agent input:

- text and image previews share the upper content area.
- one `+` action attaches either context files or images.
- `Ctrl+V`/`Cmd+V` pastes images into the same attachment list.
- one compact menu combines model and reasoning, such as `V4.1 Flash · High`; selection does not close it, and clicking outside does.
- permission mode and one contextual generation action stay in the footer. During streaming it shows Stop for an empty draft, Interrupt and guide when the draft has content, and Queue message while `Ctrl` is held. `Enter` guides, `Ctrl+Enter` queues, and `Shift+Enter` inserts a newline.

`HistoryView` lists, loads, paginates, deletes, and restores conversations. Undo remains available before permanent deletion cleans image files.

`SettingsView` has three public tabs: General, API, and Tools. Tools contains Permission mode followed by the Web search toggle and engine selector. There is no per-tool permission matrix or separate Web search tab, and saving does not show a redundant success toast. General includes Usage & cost, where the token breakdown toggle and the display currency (`USD` or `CNY`) live; changing the currency reprices the conversation popover from DeepSeek's own published table for that currency.

## Rendering

Adjacent reasoning and tool events collapse into Activity panels without changing persisted order. Every Activity panel, reasoning block, and tool list is individually collapsible: it opens while its round streams, collapses once the round ends, and can be toggled at any time. Successful `read_file` bodies are not duplicated in Chat; file tools expose Open file, and mutations expose their recorded native change view when complete. A finished assistant turn ends with the edited-files summary: one row per written file with its line counts, `Show N more files` beyond the first three, and `Review` to open every change of the turn.

A long transcript is not mounted whole. `ChatMessageWindow.ts` decides how much of the loaded conversation is rendered:

- the newest `CHAT_MESSAGE_WINDOW` (40) messages render on mount;
- every history page the user loaded from disk (200 messages per page) is added to that budget, because a page is prepended above the transcript and remounts the chat;
- `Show N earlier messages` at the top of the list reveals `CHAT_MESSAGE_WINDOW_PAGE` (40) more messages of whatever is already in memory, anchored so the message being read stays in place instead of jumping. It is the only "earlier messages" control: once every loaded message is visible, the same button shows `Load earlier messages` and asks the host for the next stored page instead of leaving older history unreachable.

Tool-call reconciliation, draft persistence, and history paging keep working on the full in-memory transcript; only the DOM is windowed. Every message row in `ChatMessages.tsx` is memoized, and only the live assistant turn receives the active tool-call groups, so typing a draft or streaming a chunk does not re-parse the Markdown of the whole conversation.

Usage totals do not come from the rendered messages, because paging leaves older ones out of memory. `summarizeConversationUsage` adds up the usage recorded by every message, the host publishes that snapshot as `conversationUsageUpdated` after each generation and inside `conversationLoaded`, and the composer popover renders it; the local sum of the in-memory messages is only a fallback for a chat the host has not reported yet.

Image cards use host-generated preview URIs. Removing a draft card asks the host to delete its local and remote resources; the webview never reads the filesystem or calls DeepSeek directly.

Clicking an attached image, either a composer thumbnail or an image of a sent message, opens `ImageLightbox`: a full-window viewer that fits the image to the window, keeps its aspect ratio, and lets the user drag the image to pan once it overflows the scrollable viewport. It exposes zoom out, the fit percentage (click to fit), zoom in, and close. Escape, the backdrop, and `+`/`-`/`0` are also handled, focus stays trapped inside the viewer, and the maths lives in the pure `ImageZoom` (scale) and `ImagePan` (scroll offset) modules.

## Controls and tooltips

One shared control language keeps panels consistent: `src/ui/styles/Variables.css` publishes the compact control metrics (`--control-radius`, `--control-min-height`, `--control-hover-bg`, `--control-focus-ring`) and both `select` and the composed composer pickers (model/reasoning, usage, attachment) use them, so the model menu matches the permission select instead of carrying its own border, height and highlight.

Tooltips are declared with `data-tooltip` on the control and rendered by the single `TooltipLayer` mounted in `App.tsx`. The layer delegates `pointerover`/`focusin` on the document, opens an `aria-describedby` reference, and portals one fixed box to `body`: anchors live inside panels that clip their children (`overflow: hidden`, container queries), and the sidebar is too narrow for a blindly centred hint. `TooltipPlacement.ts` holds the maths (flip to the opposite side when the asked one has no room, keep `6px` from the viewport edges), `data-tooltip-position` and `data-tooltip-align` choose the side and the alignment, hover waits `350ms`, focus shows immediately, and pointer, click, `Escape` and blur dismiss it. Native `title` attributes are kept only where they describe truncated content the browser draws itself.

## Responsive behavior

All controls use the webview viewport, `min-width: 0`, minimal horizontal padding, wrapping, and content-sized menus. The combined model/reasoning popover follows its actual content width and stays within the viewport. No supported sidebar width should require horizontal scrolling.

[Back](INDEX.md)

[Back](INDEX.md)

# State and Messaging

The UI uses `apps/webview/VsCodeApi.ts` and validated protocol-v5 `postMessage` contracts from `apps/vscode/src/contracts/messages`.

## Relevant state

- `useMessageHandler` applies correlated host events.
- `useStreamHandler` batches text while preserving chronological boundaries.
- `useChatConfig` tracks authoritative configuration revisions.
- `useToolCallController` owns approvals and results for one generation.
- `FileSelector` offers only safe `./` workspace completions.
- `ChatView` state schema 5 retains the current draft, context references, pending image metadata, presentation messages, conversation identity, and mode-safe recovery data.

## Rules

- React never accesses the filesystem, API key, or DeepSeek API directly.
- Host messages are the authority for attachment upload/deletion, tool state, permissions, history, and workspace binding.
- Stream and tool events are accepted only for their active conversation/generation pair.
- Explicit Stop preserves the submitted message and partial timeline as a terminal `cancelled` turn; it does not recreate a draft.
- Steering queues the guidance first, persists bounded partial continuity as `interrupted`, and links the continuation to that exact source generation. The next system context identifies the latest message as live guidance; the webview suppresses the internal interruption warning for `steered` only.
- Queued prompts recovered after shutdown are offered as drafts and removed only after consumption.
- Clipboard image Base64 is discarded after upload acknowledgement and never placed in `vscode.setState`, history, or provider messages.
- Switching Chat, History, and Settings keeps the webview mounted. Incognito state remains memory-only across those internal views and disappears on actual extension/webview recreation.

[Back](INDEX.md)

[Back](INDEX.md)

# Verification

## Before closing code changes

Run:

```bash
pnpm run compile
pnpm run lint
pnpm run build
pnpm run test:unit
pnpm run test:integration
git diff --check
```

## Web documentation

Run in `web-doc`:

```bash
pnpm run build
```

## Manual validation

In Extension Development Host:

- open the YCraSy DeepSeek Agent sidebar.
- save API key.
- test connection.
- send a message with streaming.
- send messages in different conversations and verify they can run concurrently up to the configured limit.
- send a second message in the same conversation and verify it remains queued.
- during a generation, verify the single contextual button shows Stop for an empty draft, Guide for content, and Queue while `Ctrl` is held. Verify `Enter` guides before older queued prompts, `Ctrl+Enter` appends to the queue, and `Shift+Enter` inserts a newline.
- cancel conversation A, immediately create conversation B, then deliver late stream, tool, error, and terminal events for A; verify B keeps a new identity and never renders or receives A's work.
- cancel a generation and verify its prompt, partial response, reasoning, and completed tool results remain as one terminal `cancelled` turn; verify completed side effects are not rolled back and repeated or stale Stop requests are harmless.
- switch repeatedly between two concurrent conversations; verify both complete, history shows queued/running/cancelling activity, and snapshots rebuild only the selected chat.
- verify steering records `interrupted` with stop reason `steered`, queues guidance first, injects continuation semantics only for the matching source generation, and does not display the internal interruption warning. Verify stale metadata becomes an ordinary follow-up and explicit Stop remains visibly `cancelled`.
- cancel before run creation and during context, compaction, partial streaming, confirmation, browser work, terminal work, and mutation-lock wait; verify exactly one terminal event and no deferred mutation after cancellation.
- reload or recreate the webview during a run and verify the generation snapshot restores visible state.
- close VS Code with active and queued work, then verify partial output and queued prompts recover on activation.
- use history.
- type `./` in the chat input and select a suggested path; verify `../` never opens autocomplete and is rejected if sent manually.
- attach an ordinary file and an image through the same `+` picker; verify signature-based routing, preview, removal, and a maximum of eight images.
- paste JPEG, PNG, GIF, and WebP images with `Ctrl+V`/`Cmd+V`; verify the bounded Base64 IPC value is discarded after upload and never appears in history or provider messages.
- verify image file IDs are sent directly to `deepseek-flash` as `{ type: "file", file_id }` content blocks.
- simulate 404, 410, 429, and generic 5xx responses on the official origin; verify the failure is surfaced without a hidden retry, without dropping the already-sent image references, and without rewriting a custom-origin model name.
- delete a conversation containing images, use Undo, then permanently delete it and verify preview/remote cleanup happens only after the Undo window.
- execute a safe tool.
- confirm or cancel a dangerous tool.
- open a file from preview.
- delete a conversation with active or queued work and verify its run, queue, and checkpoint are removed first.
- run mutating tools from concurrent conversations and verify mutations remain serialized within the same workspace.
- verify the API-key preview appears as the input placeholder on first open.
- verify auto-approve and full-access use the independent DeepSeek reviewer without a local danger analyzer, apply routine/elevated/critical policy correctly, and preserve rejection guidance without losing a generation round.
- verify grouped activity remains compact until expanded.
- verify a turn that edits several files ends with the edited-files summary;
  verify the per-file line counts, `Show N more files`, and that each row opens
  the diff for that file, and that `Review` opens every change of the turn.
- create or rewrite a file large enough to truncate the diff stored in the tool
  result and verify the change still opens completely, both from the summary and
  from `View change` on the tool call.
- reopen a conversation from history and verify small changes still open, while a
  change whose recorded diff was truncated reports that it cannot be compared.
- verify “Open file” opens the affected file and a file mutation opens the
  specific change diff.
- while typing in the chat input, trigger an `edit_file` or `apply_patch`
  confirmation and verify the inline preview appears without moving focus.
- verify confirmation panels fit narrow sidebars and use the available width in
  wide views.

## Test layout

Unit tests are grouped under `src/test/chat`, `deepseek`, `tools`, `security`,
`storage`, `webview`, and `architecture`. The unit runner discovers tests
recursively and explicitly excludes `src/test/integration`; VS Code integration
tests use their own build and runner.

## API validation

Review [Official DeepSeek references](../deepseek-api/Official-References.md) when changing:

- models.
- chat parameters.
- streaming.
- thinking mode.
- JSON output.
- tool calls.
- vision and Files API references.
- FIM.
- HTTP errors.

## Technical documentation validation

- local Markdown links resolve.
- documented paths and message names match the current source tree.
- related documentation changes ship in the same commit as code changes.

[Back](INDEX.md)

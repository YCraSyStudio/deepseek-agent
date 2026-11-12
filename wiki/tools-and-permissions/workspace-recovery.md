[Back](2.INDEX.MD)

# Workspace Recovery

## What a turn records

Before each user message, the extension fingerprints the relevant workspace files. After the turn settles — completed, cancelled or failed — it writes a real pre-turn and post-turn copy only for paths that changed, under `.snapshot/turns/<generation-id>/` inside the chat's snapshot directory. This includes changes made through terminal commands, not only file tools. A turn that changes nothing keeps no historical copy.

Snapshots are independent file copies, not hard links. They live under `~/.ycrasy-agent/snapshoots/<chat-id>/` by default, or under the configured data directory. Multiple workspace roots use their aliases as subdirectories. The storage layout and limits are documented in [Settings, History, and Privacy](../settings-and-data/settings-history-and-privacy.md#workspace-snapshots-and-revert).

## Reviewing a turn

- The edited-files summary at the end of a turn lists every written file and exposes **Review changes**.
- **Review changes** opens the saved before/after documents in the native VS Code diff. This works even when the diff embedded in a tool result was truncated for the model context.
- **View change** on a mutation tool call opens the same comparison for that file.
- The per-file rows and the summary use recovery copies, not a reconstruction from the model transcript.

If no recovery copy matches the recorded hashes — for example after retention removed it — the view falls back to the bounded excerpts stored in the tool result. A change whose recorded diff was also truncated cannot be compared.

## Reverting a turn

Three entry points invoke the same restore operation:

1. **Revert turn** in the turn summary.
2. **Revert Turn** in the editor title of a reviewed change diff (`deepseek-agent.revertReviewedTurn`).
3. The `revert_workspace` tool, through normal tool permissions and confirmation. Omitting `generationId` selects the latest unreverted completed turn.

Restoration verifies the original workspace binding, every recovery copy and the current affected files before writing. It:

- restores pre-existing uncommitted edits;
- removes files created during the turn;
- recovers deleted and binary files;
- leaves other paths, Git commits and the staging index untouched.

It refuses to run when an affected file changed after the turn, an editor has unsaved changes, the workspace is untrusted, a symlink parent escapes the workspace, or a generation is active or queued. The refusal protects later work instead of overwriting it.

## Availability and failure

- Snapshots are available only for local, file-backed workspaces. Virtual workspaces are unsupported.
- Incognito mode keeps fingerprint comparisons in memory only; disk restoration is unavailable.
- Snapshots are removed with chat deletion or history retention.
- Exceeding the quota, running out of free disk space or failing a copy never blocks the message. The turn reports that it cannot be reverted, keeps previous complete backups and cleans incomplete staging.
- A workspace can be rebound, but a snapshot belongs to the workspace binding captured for that chat.

## Related

- [Built-in tools](built-in-tools.md)
- [Safety and confirmations](safety-and-confirmations.md)
- [Settings, History, and Privacy](../settings-and-data/settings-history-and-privacy.md)
- [Provider storage, migration, and recovery](../settings-and-data/provider-storage.md)

[Back](2.INDEX.MD)

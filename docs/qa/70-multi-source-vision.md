# Multi-source vision (#70)

Dependency: #69 screenshot storage, included as a separate prerequisite commit in this branch.

Vision accepts structured requests and resolves attachments, screenshot ids and workspace-relative images independently. Flash and Pro expose the tool without requiring prompt attachments. Bytes are validated by the shared magic-byte detector; source paths use strict realpath confinement and sensitive-path guards. Sent references appear in the stored tool result, including analysis failures.

Chosen lifecycle: one upload per distinct hash within a generation, deleted on settlement/cancellation, with one-hour expiry if remote cleanup fails. Cleanup failures are logged. This preserves repeated inspection without 30-day retention, and conversation deletion already cancels/awaits the generation before removing history.

Manual validation: analyze a capture on Pro with no prompt attachments, repeat and verify one upload, cancel and verify DELETE; verify equivalent Flash operation, expired attachments, unavailable credentials and remote cleanup failure.

Conversation image numbers are assigned from the screenshot sequence when an attachment is sent and archived, and shown as a small `#N` button at the bottom right of its message thumbnail. Clicking the number inserts a localized image reference at the draft cursor and focuses the input; clicking the image itself still opens the preview. The reference catalogue is rebuilt from the current conversation's screenshot index for each generation, including after context compaction. `screenshot_ids` accepts `"1"` as an alias for `"screenshot-1"`. Numbers remain stable across reloads, are scoped to the conversation, and are never reused after eviction. Restoring older history recovers the number through the attachment-to-screenshot mapping when its stored image still exists.

Manual comparison: send three images, then say “According to images 1 and 3, the current state is still wrong” while attaching a fourth image. Verify the new thumbnail shows `#4`, and analysis uses images 1, 3 and 4. Reload the conversation and repeat without attachments. An evicted or unknown number must report an unavailable image instead of substituting another one. Incognito attachments have no persistent screenshot number.

Repeated attachments are deduplicated by SHA-256 within the conversation even when their upload UUIDs or filenames differ. They reuse the existing indexed file and image number, without consuming a sequence number. Message occurrences remain visible and restore their shared preview by that number. This deduplicates the persistent `.screenshots` archive; it does not deduplicate the initial remote attachment uploads or their pending cache files. Capture metadata for different agent targets remains separate.

Review checkpoint: compile, lint, build and 486 unit tests pass. Before closing #70, ensure partial upload failures record the references already sent, add explicit byte-limit and cancellation/conversation-deletion cleanup coverage, and complete manual API validation in the Extension Development Host. These checks remain pending.

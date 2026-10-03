# Screenshot storage (#69)

Captures live in `history/<id>/.screenshots/` and share the history mutation lock with history writes/deletion. The existing validator already ignores dot-prefixed entries and is unchanged. PNG/JPEG magic and dimensions are validated; PNG chunks, checksums and decompressed payload are checked. Limit: 16 MiB / 20 million pixels per capture, 40 files / 40 MiB per conversation. Lookup touches LRU access time; SHA-256 detects corrupt files and deduplicates identical targets. Metadata and image writes are atomic; orphan files from interrupted writes are removed on the next successful save. Corrupt indexes fail visibly rather than discarding history.

Deleting a conversation recursively removes captures. Saving after deletion refuses to recreate the directory. Conversation IDs and index filenames cannot escape storage, and symbolic links in capture directories/files are rejected. No change to legacy-storage cleanup is needed.

PNG/JPEG images attached by the user are saved through the same `ScreenshotStore` when a persistent user turn is saved. They receive incremental names (`<n>-<label>.png`, or `.jpg` for JPEG bytes), complete index metadata with `kind: attachment` and the attachment ID as `target`, and the same validation and LRU retention as agent captures. There is no separate UUID archive or retention exemption. Incognito turns do not create an archive. This storage path accepts PNG/JPEG captures; GIF/WebP support in the remote upload API does not imply support in this store. Attachment storage does not renew remote Files API expiry.

Manual check: reload the extension host, paste and send an image in a persistent conversation, and verify its bytes under `.screenshots/`. Flash receives the uploaded file as a visual content part. Test with a fresh conversation and with a follow-up about an earlier attachment. Model answers alone are not proof of whether an image was delivered; compare against the request content and attachment metadata.

Review against issue #69:

- Storage path and exported directory constant: `.screenshots/`; the conversation validator remains unchanged.
- Naming and index: incremental sequence; ID, kind, target, optional window title/PID, dimensions, byte count, SHA-256, creation and access times.
- Atomic writes: temporary image plus rename and atomic JSON replacement. An index-write failure removes the uncommitted new image and preserves the previous index and captures. A successful save removes orphan files left by interrupted writes.
- Retention: count and byte limits are both tested; lookup updates LRU access time. User images also count toward these limits.
- Lookup: persistent lookup by screenshot ID and latest capture, including deterministic ordering when creation timestamps tie.
- Lifecycle: real conversation round-trip with captures present; legacy cleanup preserves the conversation; deleting the conversation removes captures; a late save cannot recreate a deleted conversation.
- Validation tests: incomplete/corrupt PNGs, JPEG round-trip and truncated/header-only JPEG rejection, stored-file corruption, corrupt indexes, oversized captures, concurrent sequence allocation and path validation.

The store exposes bytes and a local path for preview/vision consumers. User attachment previews resolve to indexed files in `.screenshots/` on send and history reload, with that conversation's screenshot directory granted as a webview resource root. A retained attachment can be looked up by its attachment ID as well as the generated screenshot ID. Capture creation and the vision tools consuming stored capture IDs belong to subsequent issues; this branch does not add those tools.

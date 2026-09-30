# Screenshot storage (#69)

Captures live in `history/<id>/.screenshots/` and share the history mutation lock with history writes/deletion. The existing validator already ignores dot-prefixed entries and is unchanged. PNG/JPEG magic and dimensions are validated; PNG chunks, checksums and decompressed payload are checked. Limit: 16 MiB / 20 million pixels per capture, 40 files / 40 MiB per conversation. Lookup touches LRU access time; SHA-256 detects corrupt files and deduplicates identical targets. Metadata and image writes are atomic; orphan files from interrupted writes are removed on the next successful save. Corrupt indexes fail visibly rather than discarding history.

Deleting a conversation recursively removes captures. Saving after deletion refuses to recreate the directory. Conversation IDs and index filenames cannot escape storage, and symbolic links in capture directories/files are rejected. No change to legacy-storage cleanup is needed.

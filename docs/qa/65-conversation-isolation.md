# Conversation isolation (#65)

Fixed two concrete code paths: persisted UI identity was hydrated without loading history; missing request identity could reuse host context from another conversation. Deleted identities now reject instead of silently creating replacement history. Latest history-load requests win before mutating host selection. Active snapshots restore their user message and reuse the same assistant stream id.

Manual verification still required in VS Code: create chat A with a recognizable marker, start a long generation in B, switch to Codex and back, reload the webview, select A while B runs, then reopen B. Verify UI markers, stored JSON and subsequent model context independently. No historical data is reassigned or deleted; prior persisted mixing has not been established.

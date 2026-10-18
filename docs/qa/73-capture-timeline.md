# Issue #73: screenshot timeline

Branch `agent/73-capture-timeline` includes #69, #70 and #71 prerequisites as separate commits. Tool-result timeline events already record capture metadata and the resolved screenshots sent to vision. The renderer adds previews beside those events, including when reopening history; no bytes or webview URIs are persisted in messages/model context.

The extension resolves conversation + screenshot ids through the integrity-checked ScreenshotStore; the webview cannot request arbitrary paths. Resource roots add exactly the existing history directory. Clicking opens the full image in VS Code. Missing/deleted images, a missing screenshot directory, a failed image load and response timeout show an unavailable state. Listeners are removed when the preview unmounts, and responses are correlated by request and conversation.

Verified: compile, lint and unit tests for references and protocol confinement, alongside screenshot store integrity/retention tests. Manual VS Code QA remains: capture and analyze a screenshot, open full image, reopen conversation, delete a retained image, switch chats during lookup, inspect chat without captures and verify resource access outside history is blocked.

## Cloud acceptance, 2026-10-18

Read issue #73 before testing. Compile, lint and 503 unit tests pass. The real React ScreenshotPreview component ran in an owned VS Code 1.142.0 desktop webview: a confined local screenshot loaded at its real 640-pixel width, its button opened the full image editor, and a missing screenshot rendered an unavailable status. Persisted analyzer references resolve screenshot IDs. This checks the component and host asset protocol, not complete chat-history navigation. Evidence: [73-native.json](live/73-native.json).

The archived native image also passed real Flash-native and Pro-delegated vision, path validation, cache reuse and deletion of both remote uploads. Estimated model cost CNY 0.003106; [73-vision.json](live/73-vision.json).

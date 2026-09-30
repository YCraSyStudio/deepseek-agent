# Capture tool and backend contract (#71)

Dependency: #69, included as its own prerequisite commit.

`capture_screenshot` validates target selectors, viewport bounds and HTTP(S) URLs. The service resolves only its requested backend, bounds the complete capture operation to 30 seconds, validates/stores the resulting bytes and returns a conversation-relative reference plus dimensions, bytes, target/title and PID. Backends are registered independently for web, window, debug and display; absent backends fail visibly without fallback to another target. Captures do not upload data.

Whole-screen capture uses an argument-specific always-confirm rule. The execution pipeline checks it before forced execution, deterministic safety review or automatic approvals, including full-access mode. Backend implementations are supplied by #72 and #74. The tool result is the initial timeline metadata; image previews are supplied by #73.

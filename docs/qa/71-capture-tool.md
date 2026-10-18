# Capture tool and backend contract (#71)

Dependency: #69, included as its own prerequisite commit.

`capture_screenshot` validates target selectors, viewport bounds and HTTP(S) URLs. The service resolves only its requested backend, bounds the complete capture operation to 30 seconds, validates/stores the resulting bytes and returns a conversation-relative reference plus dimensions, bytes, target/title and PID. Backends are registered independently for web, window, debug and display; absent backends fail visibly without fallback to another target. Captures do not upload data.

Whole-screen capture uses an argument-specific always-confirm rule. The execution pipeline checks it before forced execution, deterministic safety review or automatic approvals, including full-access mode. Backend implementations are supplied by #72 and #74. The tool result is the initial timeline metadata; image previews are supplied by #73.

Live acceptance (18 October 2026): the actual capture tool and CaptureService stored pixels captured from an owned X11 test window (640×480), returned only metadata, and emitted one capture event. Whole-display requests returned the confirmation requirement without taking a screenshot; missing backends failed explicitly. This contract-only branch used an injected runner performing the real ImageMagick window capture; shipped web/native mechanics are tested separately in #72/#74. Flash read this captured image natively, Pro delegated the stored image successfully, hash reuse avoided an extra upload, and both temporary DeepSeek files were deleted. Estimated model cost: CNY 0.003120. Compile/lint and 501 unit tests pass, including inherited vision lifecycle corrections.

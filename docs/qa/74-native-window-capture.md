# Issue #74: native capture

`agent/74-native-window-capture` is based on `develop-agent`, with #69, #71 and #72 prerequisite commits. Compile, lint and 475 unit tests pass. Five native fixtures cover parsing, exact/ambiguous/hidden targets, PNG filter reconstruction and uniform detection, Windows helper scoping, X11 output handling, cleanup and Wayland failure. Helper timeout/cancellation is covered by #72.

| Host | Catalog | Capture | Limit |
| --- | --- | --- | --- |
| Linux X11 | `wmctrl -lpG` | ImageMagick `import -window id`, forced RGB PNG | Requires wmctrl + ImageMagick + DISPLAY; no dependency installed automatically |
| Linux Wayland | Unsupported without portal | Explicit error | Never substitutes screen capture |
| Windows | PowerShell user32 EnumWindows, PID/title/rect/visibility | PrintWindow(2); CopyFromScreen only if no higher visible window rectangle overlaps | Hidden/minimized/ambiguous/black windows fail; overlapping transparent windows conservatively block fallback |
| macOS | JXA CoreGraphics on-screen window catalog | `screencapture -l id` | Screen Recording permissions required; catalog may hide titles without permission |
| Remote/web VS Code | Explicit error | None | Extension host cannot capture a different UI machine |

`process` is an exact numeric PID; `window` is an exact title or catalog id. `debug` uses the active debug session's DAP process event, or its explicit processId. If no PID is exposed, request a PID/title; do not infer from the foreground window or a shell's unrelated children. GPU/blank captures fail before ScreenshotStore. Full-display capture uses the existing always-confirm guard from #71 and is never an implicit fallback.

Visibility is known; general occlusion is unknown on X11/macOS. Windows checks overlapping higher windows when deciding whether screen-copy is safe, but cannot eliminate a window moving during the actual copy. Use PrintWindow when it produces useful output. Native helper scripts and desktop permissions require real-platform validation; none of the Windows/macOS helpers were executed on this Linux host. The fixture tests are not proof of Windows/macOS compatibility.

Manual: Unity/JavaFX/Avalonia/WinUI visible, occluded, minimized and GPU windows; active debug PID; stale/ambiguous titles; helper not installed; deny macOS permission; cancel/timeout and inspect process cleanup. macOS explicit screen mode captures the primary display; X11/Windows capture their root/virtual desktop.

## Unity Game view

Window capture requires no project edits. A clean Game-view capture may use a requested `Assets/Editor` helper calling `ScreenCapture.CaptureScreenshot` from an Editor menu while playing. Generate that helper only when the user requests it; it is not inserted by this implementation.

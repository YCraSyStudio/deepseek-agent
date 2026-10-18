# Issue #72: web viewport capture

Branch: `agent/72-web-viewport-capture`, based on `develop-agent` with #69 and #71 prerequisite commits.

## Implementation

`capture_screenshot({target:"web",url,width,height,wait_ms})` launches an owned `editor-browser` debug session on local desktop VS Code, obtains its `requestCDPProxy` endpoint and sends `Page.captureScreenshot` with an explicit clip bounded to the requested viewport (including when the editor pane is narrower). It sets DPR to 1 and waits for load/paint with a background-frame timeout. Node 24's WebSocket is used; no browser or WebSocket dependency is bundled. Only the owned session is stopped; existing tabs are not inspected.

When integrated capture is unavailable, system Chrome/Chromium/Edge runs headless with a temporary isolated profile, bounded output/deadline and process-tree cancellation. Authentication from the user's browser profile is not imported. Remote hosts use the system browser on that host. Missing browsers return an actionable error. Browser access is `ask` (per-origin approval per extension session), `always` or `never`, independent of tool permission mode.

## Spike evidence and limits

Checked Microsoft sources: `vscode-js-debug/src/adapter/debugAdapter.ts` exposes `requestCDPProxy`; `src/adapter/cdpProxy.ts` returns `{host,port,path}` for one session/target. `vscode/src/vscode-dts/vscode.proposed.browser.d.ts` declares `openBrowserTab` under proposal `browser`. This implementation uses stable debug APIs and does not enable a proposed API. The CDP proxy itself is an internal js-debug contract and may change; fallback handles its absence.

A real desktop extension-host spike now passes on VS Code 1.142.0/Linux/X11: the owned integrated browser renders a local fixture and returns a 640 × 480 PNG, browserAccess=never blocks before launch, and both owned debug sessions terminate. See [72-native.json](live/72-native.json). Background/minimized-window freshness and compatibility with the declared VS Code 1.131 minimum still need platform acceptance. System Chromium on this cloud host times out; its fallback is not certified by the integrated-browser result.

## Checks

TypeScript and lint; unit coverage for viewport geometry, page-side load failure, proxy scoping, cancellation and helper timeout. Manual: capture a running dev server; deny/allow origin and change policy; test unsupported integrated browser and missing system binary; stop during loading and verify no helper/session remains; test login, background and minimized cases; inspect VSIX contents.

## Real-test fixes, 2026-10-18

The launcher is not the page adapter: it can leave `requestCDPProxy` unanswered. Wait for its owned descendant, bound each probe and cleanup, and allow cold debug activation within the outer capture deadline. Capture an explicit emulated viewport clip so a narrow editor cannot silently crop the requested image. Close only the owned page through CDP before terminating its sessions. Regression tests cover an unanswered launcher, unrelated sessions, adapter timeout and clip geometry. Compile, lint and 511 unit tests pass.

The captured browser PNG was also uploaded through the production image client: Flash read it natively without an unnecessary tool call; Pro called `analyze_images`, delegated to Flash, and answered correctly. Both remote files were deleted. Estimated vision model cost: CNY 0.003120; [72-vision.json](live/72-vision.json).

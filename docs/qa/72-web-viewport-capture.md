# Issue #72: web viewport capture

Branch: `agent/72-web-viewport-capture`, based on `develop-agent` with #69 and #71 prerequisite commits.

## Implementation

`capture_screenshot({target:"web",url,width,height,wait_ms})` launches an owned `editor-browser` debug session on local desktop VS Code, obtains its `requestCDPProxy` endpoint and sends `Page.captureScreenshot` with `captureBeyondViewport:false`. It sets DPR to 1 and waits for load/paint with a background-frame timeout. Node 24's WebSocket is used; no browser or WebSocket dependency is bundled. Only the owned session is stopped; existing tabs are not inspected.

When integrated capture is unavailable, system Chrome/Chromium/Edge runs headless with a temporary isolated profile, bounded output/deadline and process-tree cancellation. Authentication from the user's browser profile is not imported. Remote hosts use the system browser on that host. Missing browsers return an actionable error. Browser access is `ask` (per-origin approval per extension session), `always` or `never`, independent of tool permission mode.

## Spike evidence and limits

Checked Microsoft sources: `vscode-js-debug/src/adapter/debugAdapter.ts` exposes `requestCDPProxy`; `src/adapter/cdpProxy.ts` returns `{host,port,path}` for one session/target. `vscode/src/vscode-dts/vscode.proposed.browser.d.ts` declares `openBrowserTab` under proposal `browser`. This implementation uses stable debug APIs and does not enable a proposed API. The CDP proxy itself is an internal js-debug contract and may change; fallback handles its absence.

These are source checks, not a completed extension-host spike. End-to-end integrated capture, background/minimized-window freshness, and compatibility with the declared VS Code 1.131 minimum remain manual validation requirements. No live-frame guarantee is inferred from unit tests.

## Checks

TypeScript and lint; unit coverage for viewport geometry, page-side load failure, proxy scoping, cancellation and helper timeout. Manual: capture a running dev server; deny/allow origin and change policy; test unsupported integrated browser and missing system binary; stop during loading and verify no helper/session remains; test login, background and minimized cases; inspect VSIX contents.

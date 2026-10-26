# Managed Chromium for web reads and screenshots

- `ChromiumProvider` finds Chrome, Chromium, Edge, Brave or Vivaldi on the extension host before consulting its managed cache. Both `read_web` and web screenshots use the same provider. Personal browser profiles are never opened.
- When absent, Chrome Headless Shell is downloaded from the official Chrome for Testing stable channel into VS Code global storage. Installation is staged before the finished directory is published. Concurrent read/capture requests share the installation. Updates are checked on use at most daily; a failed update retains the installed binary and retries after an hour. The current and previous managed releases are retained; older managed versions are cleaned up after a successful check. User browsers are never updated.
- A Chromium process and temporary profile are owned by each operation and removed after completion, cancellation or failure. Downloading is shared and may finish after an individual caller cancels. Screenshots allow up to ten minutes for first installation; actual page reads have a separate thirty-second rendering deadline after browser preparation.
- Public page reads use a local HTTPS CONNECT proxy that rejects private destinations and pins connections to validated public DNS results. Document redirects are checked against the web authorization policy. Public webpage reads no longer call DeepSeek Fetch; Search and retained Search content remain unchanged.
- First use requires network/disk capacity; Linux requires installed Chromium libraries and a working sandbox. There is no managed Linux ARM build. The production launcher does not disable Chromium's sandbox.

## Validation

- Unit tests cover system-browser preference, shared installation, persistent update cadence, stable upgrades, offline fallback, missing executables, cancellation, web authorization/settings/disposal and rejection of private/HTTP proxy targets.
- Live smoke checks downloaded the official Headless Shell, selected the installed system Chromium, and rendered a local HTML fixture with JavaScript and an 800×600 PNG in both browsers.
- This cloud worker's system sandbox helper is not configured for production Chromium sandboxing. Fixture-only smoke checks used `--no-sandbox`; production flags retain the sandbox. This is not an end-to-end validation of public website retrieval in a supported desktop environment.

[Back](INDEX.md)

# Release Channels and Publishing

## Versioning policy

The extension follows an alternating stable/pre-release scheme on the minor version line. **Even minor versions are stable; odd minor versions are pre-release (unstable).**

| Line       | Stability                                      | `preview` flag |
|------------|------------------------------------------------|----------------|
| `0.1.x`    | Pre-release (unstable) — current               | `true`         |
| `0.2.x`    | Stable (first stable release)                  | `false`        |
| `0.3.x`    | Pre-release (unstable)                         | `true`         |
| `0.4.x`    | Stable                                         | `false`        |
| `0.5.x`    | Pre-release (unstable)                         | `true`         |
| ...        | Alternates from here on                        |                |

The `0.1.x` line is **not stable**. Bugs found in daily use continue to be fixed and published as incremental patch releases (`0.1.14`, `0.1.15`, `0.1.16`, ...) for as long as needed. We remain on `0.1.x` until no removal-worthy errors remain in daily use.

Once the `0.1.x` work stabilizes, the extension advances to **`0.2.x`** as the first stable release. After that, the next unstable work moves to `0.3.x`, and the pattern repeats (`0.4.x` stable, `0.5.x` pre-release, ...).

Example lifecycle:

```text
0.1.14  Pre-release (incremental fix)
0.1.15  Pre-release (incremental fix)
0.1.16  Pre-release (incremental fix)
   ↓  ready when no daily-use errors remain
0.2.0   Stable
   ↓  next unstable phase
0.3.0   Pre-release
0.3.1   Pre-release (incremental fix)
   ↓  ready when no daily-use errors remain
0.4.0   Stable
```

- `0.1.x` (and every odd-minor) releases may be published as often as needed to address remaining bugs.
- `0.2.x` is the first stable release; it is cut only when daily-use testing no longer surfaces errors, deferred across `0.1.15`, `0.1.16`, ... until then.
- `preview` stays `true` for every odd-minor (`0.1.x`, `0.3.x`, ...) build and is set to `false` at each even-minor stable line (`0.2.x`, `0.4.x`, ...).

Do not use SemVer suffixes such as `-beta.1` or `-preview.1` for Marketplace package versions. The version number and the `preview` gallery flag together identify release stability.

## Target release

For the current branch, `0.1.15` is the current preview target. Keep `package.json` and the root lockfile aligned to that release until it is cut.

After `0.1.15`:

- each subsequent `0.1.x` release keeps `preview: true` and the normal Marketplace channel;
- remaining bugs are tracked across `0.1.16`, `0.1.17`, ... until `0.1.x` stabilizes;
- the line is promoted to `0.2.x` with `preview: false` only once daily-use testing reports no remaining errors.

## Marketplace metadata

- Publisher: `yarcrasy`
- Repository: `https://github.com/YCraSyStudio/deepseek-agent`
- License: MIT
- Categories: `AI`, `Chat`
- Main entry: `dist/extension.js`
- Activity bar icon: `src/assets/DeepSeekIcon.svg`

## Required checks

Run from the repository root:

```bash
pnpm run compile
pnpm run lint
pnpm run build
pnpm test
```

Run the human documentation build:

```bash
cd web-doc
pnpm run build
```

The Astro build output is the repository root `docs/` folder. Configure GitHub Pages to serve from the main branch `/docs` folder.

Package the VSIX:

```bash
pnpm dlx @vscode/vsce package --no-dependencies
```

Do not use the deprecated `vsce` package. Older versions still require explicit `activationEvents`; modern VS Code generates activation events from contribution declarations.

## Marketplace publishing

### Pre-release releases: odd-minor lines (0.1.x, 0.3.x, ...)

Every odd-minor release is published through the normal release channel while retaining `preview: true` in `package.json`.

```bash
# Example: 0.1.14, 0.1.15, 0.1.16, 0.3.0
npx @vscode/vsce publish
```

Do not publish odd-minor builds with `--pre-release`; the `preview: true` gallery flag is what identifies them as preview builds.

### Stable releases: even-minor lines (0.2.x, 0.4.x, ...)

Even-minor releases are published normally with `preview: false`:

```bash
# Example: 0.2.0, 0.4.0
npx @vscode/vsce publish
```

A pre-release build (odd minor) must never be republished as stable with the same version number. The stable step is the next even-minor line only, cut once daily-use testing reports no remaining errors.

## GitHub release

Before creating the extension tag, publish the immutable SearXNG sidecar release from the exact `main` commit intended for the release:

```bash
gh workflow run searxng-runtime.yml --ref main
gh run list --workflow searxng-runtime.yml --limit 1
gh run watch <run-id> --exit-status
pnpm run verify:searxng-runtime
```

The runtime workflow reads the `v2` metadata pinned in the extension, builds and smoke-tests all five supported binaries, verifies their sizes and SHA-256 digests against the VSIX trust anchor, and creates the prerelease atomically. It refuses to modify an existing runtime release.

Push a `vX.Y.Z` tag after `main` points at the release commit:

```bash
# Example: 0.1.13, 0.1.14, ..., 0.2.0, 0.3.0, ...
git tag v0.1.14
git push origin v0.1.14
```

A push to `main` whose commit subject starts with `release: ` publishes the same way, so a release no longer needs a hand-created tag before the gates run:

```bash
git commit -m "release: fix v0.1.14 preview"
git push origin main
```

The production workflow resolves the release mode in its first step and publishes the VSIX and checksum only after quality, extension-host, and packaged-VSIX smoke gates pass. The rules are:

- a pushed `vX.Y.Z` tag always publishes;
- a push to `main` publishes when the commit **subject** starts with `release: ` (case-insensitive, first line only); the tag is derived from the `package.json` version (`0.1.14` → `v0.1.14`) and the commit is validated against `CHANGELOG.md`;
- `release: ` commits on any other branch, in a pull request, or in a manual dispatch never publish;
- the tag is created at the tested commit when it does not exist yet, and a release that already exists is skipped, so a re-run never publishes twice.

The workflow must validate the release against `package.json`, extract the matching section from `CHANGELOG.md`, wait for quality, extension-host, and packaged-VSIX smoke gates, verify `sha256.txt`, and publish the verified VSIX and checksum.

GitHub release status mirrors the Marketplace `preview` flag:

- every odd-minor (pre-release) build remains a GitHub prerelease;
- every even-minor (stable) release is a normal GitHub release.

Publish only after installing the packaged VSIX in a clean profile and testing an upgrade from the previous Marketplace release.

## Manual release validation

- Open Extension Development Host.
- Open YCraSy DeepSeek Agent from the Activity Bar.
- Save and test a DeepSeek API key.
- Send a normal chat message.
- Send a prompt that needs a file and select a path through `./` autocomplete.
- Verify tool call confirmation, execution, and result rendering.
- Switch between Chat, History, and Settings while a tool call is pending.
- Queue a second prompt in the same conversation.
- Start another conversation and verify both generations can progress concurrently.
- Use Interrupt and guide and verify the guidance runs before older queued prompts.
- Cancel generation and verify the terminal `cancelled` turn retains the prompt, partial response, reasoning, and completed tool results without rolling back side effects.
- Attach an image and a context file through the same picker, paste an image with `Ctrl+V`/`Cmd+V`, and verify removal and preview rendering.
- Verify DeepSeek V4.1 Flash reads attached file IDs directly.
- Close and reopen VS Code during active and queued work; verify partial output is saved and queued prompts appear as recoverable drafts.
- Open a file from a tool result.
- Verify Settings tooltips and select controls render correctly, and that composer tooltips (attach, model picker, permission mode, send/Stop) stay fully inside the sidebar instead of being clipped at its edges.
- Verify the model/reasoning trigger and the permission select share height, radius and highlight.
- Enable Incognito mode, verify the chat survives in memory without history/checkpoints, then test both explicit save and discard transitions.
- Enable the usage breakdown and verify request/report coverage, reasoning, cache hit/miss, conversation totals, and official V4 cost estimates after a normal and a tool-assisted generation.
- Verify custom API origins do not receive DeepSeek-specific `stream_options` automatically and never show an estimated cost.
- Switch Settings → Usage & cost between USD and CNY and verify the usage popover reprices the reported tokens from DeepSeek's own table for the selected currency.
- Verify `list_workspace` returns the project as one indented tree, includes hidden entries, and summarizes an oversized folder as `...`.
- Open a long conversation and verify only its newest messages mount, that `Show N earlier messages` reveals more without moving the message being read, and that a pending `edit_file` or `apply_patch` preview does not steal focus.
- Click an attached image and verify the viewer fits, zooms, and can be dragged to pan without squashing the image.
- Verify a finished turn ends with the edited-files summary and that `Review` opens every change of the turn.
- Verify SearXNG starts automatically, exposes its engine catalog, respects custom engine selection, and performs `search_web` without requiring Chromium, Docker, Podman, or a system Python installation.
- Open Diagnostics and verify generation/conversation usage summaries contain counts and phases but no prompt, response, command, or path content.

## Known constraints

- DeepSeek is the only AI provider.
- At most one generation runs per conversation; the global concurrent-generation limit is configurable from 1 to 16.
- Tool execution is workspace-sensitive and should be reviewed before auto approval.
- Webview tooltips come from the shared portalled `TooltipLayer` and mimic VS Code theme variables; native VS Code hover widgets are not reachable from the webview.
- Explorer clipboard URI access is not used; workspace references use path autocomplete or the unified picker. Clipboard image data is supported separately through bounded webview IPC.

[Back](INDEX.md)

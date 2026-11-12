[Back](2.INDEX.MD)

# DDR 004 · Release Channels

## Context

The `0.1.x` line is still used daily and receives incremental fixes. The project needs an unambiguous distinction between unstable work and the first stable release without relying on SemVer suffixes in Marketplace versions.

## Decision

Alternate stable and pre-release lines on minor versions. Even minor versions are stable and set `preview` to `false`; odd minor versions are pre-release and set it to `true`. Keep the `0.1.x` line in pre-release until daily use no longer surfaces removal-worthy errors, then cut `0.2.0` as the first stable release.

Do not add `-beta` or `-preview` suffixes. Publish a pushed `vX.Y.Z` tag, or a `main` commit whose subject starts with `release: `, only after the quality, extension-host and packaged-VSIX gates pass.

## Consequences

The version number and the `preview` flag together identify the channel. A pre-release version is never republished as stable under the same number. Backward compatibility for saved conversations becomes a release commitment at the first stable line, and generated documentation must be included in the release commit. See [release channels and publishing](../../beta-publishing.md) for the checks and commands.

[Back](2.INDEX.MD)

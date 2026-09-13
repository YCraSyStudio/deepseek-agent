## Context

Workspace capabilities, production packaging, VSIX allowlisting, and local smoke-test infrastructure are implemented. Issue 021 is closed by user acceptance and issue 023 was dropped as optional hardening, so the stable release is gated only on verification of the exact CI artifact.

## Objective

Publish one verified CI artifact with matching version, status, and checksums across distribution channels.

## To-Do List

- [ ] Validate the CI-built VSIX in local, untrusted, multi-root, and virtual workspaces, including manifest behavior. Blocked: no release-candidate CI artifact has been selected for this task.
- [ ] Choose the stable version, commit release metadata, update changelog and website translations, and remove preview status only after all gates pass. Blocked: stable version and release candidate are not selected.
- [ ] Publish the exact CI artifact to Marketplace and a GitHub prerelease. Blocked: release gates remain open and publication is not authorized by this implementation task.
- [ ] Compare Marketplace/GitHub downloads with the CI SHA-256 and verify version/status consistency across README, website, changelog, manifest, and release pages. Depends on publication of the selected artifact.

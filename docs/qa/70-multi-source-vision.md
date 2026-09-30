# Multi-source vision (#70)

Dependency: #69 screenshot storage, included as a separate prerequisite commit in this branch.

Vision accepts structured requests and resolves attachments, screenshot ids and workspace-relative images independently. Flash and Pro expose the tool without requiring prompt attachments. Bytes are validated by the shared magic-byte detector; source paths use strict realpath confinement and sensitive-path guards. Sent references appear in the stored tool result, including analysis failures.

Chosen lifecycle: one upload per distinct hash within a generation, deleted on settlement/cancellation, with one-hour expiry if remote cleanup fails. Cleanup failures are logged. This preserves repeated inspection without 30-day retention, and conversation deletion already cancels/awaits the generation before removing history.

Manual validation: analyze a capture on Pro with no prompt attachments, repeat and verify one upload, cancel and verify DELETE; verify equivalent Flash operation, expired attachments, unavailable credentials and remote cleanup failure.

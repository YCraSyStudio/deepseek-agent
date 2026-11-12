[Back](2.INDEX.MD)

# DDR 002 · Test Strategy

## Context

Unit tests can cover branches cheaply, while VS Code integration tests exercise real wiring at a higher cost. Mock-heavy tests can pass while the assembled feature fails, and raw test or coverage counts do not show whether a real defect is protected.

## Decision

Treat the suite as a pyramid. Give each behavior one primary test at the lowest level that can still fail for a real defect, and add an end-to-end flow only when the wiring itself is the risk. Keep observable contracts, failure handling, cancellation, concurrency, persistence and security decisions covered.

Do not use test count or a coverage percentage as the acceptance target. Keep the strict 100% coverage command as an optional diagnostic, not a release gate.

## Consequences

A fix may add one focused unit test, one integration flow, or both when branch behavior and wiring are separate risks. Duplicate assertions are reviewed when a feature changes, but unique regressions are not deleted merely to reduce the count. The full unit and integration suites still run before a release, and coverage reports remain outside the VSIX. See [verification](../../verification.md#maintaining-the-test-suite) and [regression coverage](../../regression-coverage.md) for the working rules.

[Back](2.INDEX.MD)

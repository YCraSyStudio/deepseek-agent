[Back](2.INDEX.MD)

# DDR 006 · Complexity metric

## Context

Line counts alone do not show how many independent paths a function contains. The codebase has large validators, reducers and event handlers where a low line count can still hide dense branching. The project needs one complexity metric that is native to the existing toolchain and can be adopted without a repository-wide refactor.

## Decision

Use ESLint's core `complexity` rule with a hard limit of 15 and a target of 10. Do not add `eslint-plugin-sonarjs` for cognitive complexity while the core rule covers the need.

The rule is an error in `eslint.config.mjs`. Existing violations are frozen in `eslint-suppressions.json`; new code must not add entries. Prune suppressions when a function is split or rewritten. Prefer extraction, table-driven dispatch or explicit state transitions over mechanically splitting a function to satisfy the counter.

## Consequences

Validators with many independent cases may exceed the limit even when they are easy to read. Those functions should move to data tables or dedicated validators rather than acquire artificial helper layers. `npm run lint` blocks new complexity debt while the baseline keeps current debt visible and reviewable. Reconsider the Sonar rule only if the team needs a metric that weights nesting more strongly than independent branches. See [conventions](../../conventions.md#code) and [verification](../../verification.md#before-closing-code-changes).

[Back](2.INDEX.MD)

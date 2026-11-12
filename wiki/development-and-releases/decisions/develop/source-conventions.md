[Back](2.INDEX.MD)

# DDR 005 · Source Conventions

## Context

The codebase separates domain, application, infrastructure and VS Code layers. Reviewers need to locate behavior quickly, keep dependencies visible and avoid comments or compatibility shims that become stale beside the code they describe.

## Decision

Express intent through names, types and structure. A short comment may explain a non-obvious reason or link to the canonical wiki section with `// See wiki/<section>/<page>.md#<anchor>.` Do not restate code, duplicate a documented rule or keep commented-out code. Retain only the directives tooling requires. Keep aliases consistent with `tsconfig.json`, place shared serializable messages in `src/contracts`, and keep barrels at layer or feature boundaries.

Do not store secrets outside `SecretStorage`, do not reintroduce Ollama, and increment `WEBVIEW_PROTOCOL_VERSION` for protocol-breaking changes. Treat the suggested file, folder and parameter counts as review signals rather than automatic rejection thresholds.

## Consequences

Code must be understandable from its declarations, which makes naming and type design part of the review. ESLint and architecture tests enforce dependency directions and cycles, while cohesive data tables, generated files and tests may justify guideline exceptions. Compatibility re-exports are temporary, and removing a public id or persisted key remains a deliberate, versioned change. See [conventions](../../conventions.md#code) for the complete rules and exceptions.

[Back](2.INDEX.MD)

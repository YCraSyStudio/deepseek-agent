[Back](2.INDEX.MD)

# ADR 001 · Layer Boundaries

## Context

Business rules and use cases need to be testable independently of VS Code, React, Node storage and DeepSeek HTTP.

## Decision

Dependencies point inward. `domain` contains pure rules and `application` owns use cases and ports. The `infrastructure` and `vscode` layers implement those ports. The `ui` layer consumes contracts and browser-safe shared code. `ExtensionCompositionRoot` creates concrete adapters once and injects them into the components that use them.

## Consequences

New code imports the owning module directly. Temporary compatibility re-exports can remain during migration. ESLint enforces import restrictions, and `LayerBoundaries.test.ts` checks layer boundaries and rejects dependency cycles. See the [dependency rules](dependency-rules.md) for the allowed directions.

[Back](2.INDEX.MD)

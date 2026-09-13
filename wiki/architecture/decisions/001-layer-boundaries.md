# ADR 001: Lightweight hexagonal boundaries

Status: accepted

Business rules and use cases must be testable without VS Code, React, Node storage, or DeepSeek HTTP. Dependencies therefore point inward: `domain` is pure; `application` owns use cases and ports; `infrastructure` and `vscode` implement those ports; `ui` consumes only contracts and browser-safe shared code; `extension` is the composition root.

Concrete adapters are created once by `ExtensionCompositionRoot` and injected. Temporary compatibility re-exports may exist during migration, but new code must import the owning module directly. ESLint and `LayerBoundaries.test.ts` enforce the rules and reject source dependency cycles.


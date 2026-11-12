[Back](2.INDEX.MD)

# DDR 001 · Toolchain Baseline

## Context

The extension and the Astro documentation share one root lockfile. Local development and CI need the same dependency graph, while ESLint, Astro and the VS Code typings constrain which Node and TypeScript versions can be adopted.

## Decision

Use Node 26 LTS locally and Node 24 in CI. Pin npm 12.2.1 in `package.json`, install with `npm ci` at the repository root, and update the single `package-lock.json` with `npm install`.

Keep TypeScript 6, `@types/node` 24 and VS Code types below the extension's minimum supported editor version. The unit runner uses Mocha 12, while `@vscode/test-cli` keeps Mocha 11. Keep the security overrides and the version-pinned lifecycle-script approvals listed in [verification](../../verification.md#dependency-updates). See [scripts](../../scripts.md) for the local commands.

## Consequences

A local/CI version split is acceptable only while the tested behavior remains the same. Raising Node, TypeScript or either type baseline requires a separate compatibility review of the runtime, the minimum VS Code version and the tooling. TypeScript 7 waits until typescript-eslint and Astro accept it, and Mocha 12 is not forced into `@vscode/test-cli`. New lifecycle scripts are reviewed individually instead of enabling all scripts.

[Back](2.INDEX.MD)

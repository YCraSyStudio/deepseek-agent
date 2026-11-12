[Back](2.INDEX.MD)

# Repository Structure

Place a change in the module that owns the behavior. Group related files by feature within their layer and use the [dependency rules](dependency-rules.md) when a feature needs to cross a boundary.

## Source and tests

| Path | Responsibility |
| --- | --- |
| `src/Extension.ts`, `src/extension/` | Extension entry point, composition, and lifecycle. |
| `src/domain/` | Domain models and rules independent of the host and provider. |
| `src/application/` | Use cases, coordination, and ports for external behavior. |
| `src/contracts/` | Serializable contracts shared across boundaries. |
| `src/infrastructure/` | DeepSeek, storage, browser, and other concrete adapters. |
| `src/vscode/` | VS Code commands, host webviews, workspace access, and adapters. |
| `src/ui/`, `src/assets/` | React webview and extension assets. |
| `src/shared/` | Shared utilities that respect their consumers' runtime boundaries. |
| `src/test/` | Tests organized by feature. VS Code integration flows live in `src/test/integration/`. |

For example, a new workspace tool puts its application policy in `src/application/tools/` and its concrete built-in implementation in `src/infrastructure/tools/builtins/`. VS Code-specific access belongs in `src/vscode/tools/`. Its tests go under the corresponding area in `src/test/`.

Feature-specific locations that are easy to miss:

| Path | Responsibility |
| --- | --- |
| `src/infrastructure/workspace/` | Recovery snapshot capture, capacity checks, and restore storage. |
| `src/vscode/workspace/` | Workspace bindings, root aliases, context capture, and change tracking. |
| `src/vscode/completions/` | `CompletionService`, editor context, chat suggestion context, and registered editor features. |
| `src/vscode/editor/` | Editor actions and the `ycrasy-change` diff viewer. |

## Build and documentation

| Path | Responsibility |
| --- | --- |
| `scripts/`, `.github/workflows/` | Build, test, packaging, and CI automation. |
| `web-doc/` | Astro source for the public documentation site. |
| `docs/` | Generated output of the public documentation site. |
| `wiki/` | Technical documentation for contributors and maintainers. |

## Wiki sections

Start at the [wiki index](../2.INDEX.MD). Each section owns the following topics.

| Section | Topics |
| --- | --- |
| [Architecture](2.INDEX.MD) | Repository layout, layers, and dependency rules. |
| [Chat and Models](../chat-and-models/2.INDEX.MD) | Message lifecycle, streaming, context limits, and DeepSeek models. |
| [Tools and Permissions](../tools-and-permissions/2.INDEX.MD) | Tool calls, execution, approval, and browser captures. |
| [Extension and Interface](../extension-and-interface/2.INDEX.MD) | VS Code integration, React webview, and the message contract. |
| [Settings and Data](../settings-and-data/2.INDEX.MD) | Settings, credentials, history, storage migration, and recovery. |
| [Development and Releases](../development-and-releases/2.INDEX.MD) | Design and development decisions, conventions, builds, tests, diagnostics, and publishing. |

Use the [wiki conventions](../development-and-releases/conventions.md#wiki-structure-and-navigation) when adding or moving a page.

[Back](2.INDEX.MD)

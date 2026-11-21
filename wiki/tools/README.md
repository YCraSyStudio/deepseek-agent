[Back](INDEX.md)

# Tools

Tools let DeepSeek read context, search, create files, and execute commands according to configuration and confirmations.

Application logic lives in `apps/vscode/src/application/tools`. Concrete built-ins live in
`apps/vscode/src/infrastructure/tools/builtins` and are grouped into `fileSystem`, `terminal`,
and `context`. Actions that require VS Code run through `ToolWorkspace`; its
adapter lives under `apps/vscode/src/vscode/tools`.

Principles:

- metadata and validation in `application`.
- real side effects in infrastructure and platform adapters.
- confirmation according to `default`, `auto-approve`, or `full-access`.
- image understanding through `deepseek-flash`, which reads DeepSeek Files API file IDs directly.
- structured results so the UI can render them well.
- public tool IDs and exports remain stable across internal moves.

[Back](INDEX.md)

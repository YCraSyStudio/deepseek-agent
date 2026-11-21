[Back](INDEX.md)

# Architecture

The extension is organized in layers to isolate VS Code, DeepSeek, UI, and domain logic.

Main layers:

- `apps/vscode/src/contracts`: shared serializable models between the host and webview.
- `apps/vscode/src/application`: pure conversation, context, generation, and tool rules.
- `apps/vscode/src/infrastructure`: DeepSeek HTTP/Files/SSE, browser, review, and concrete tools.
- `apps/vscode/src/vscode`: activation, commands, persistence, webviews, and VS Code adapters.
- `apps/webview`: React app that runs inside the webview.

Architecture goal: keep maintainable logic outside VS Code where possible, and make external API boundaries explicit.

[Back](INDEX.md)

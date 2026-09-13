[Back](INDEX.md)

# Architecture

The extension is organized in layers to isolate VS Code, DeepSeek, UI, and domain logic.

Main layers:

- `src/contracts`: shared serializable models between the host and webview.
- `src/application`: pure conversation, context, generation, and tool rules.
- `src/infrastructure`: DeepSeek HTTP/Files/SSE, browser, review, and concrete tools.
- `src/vscode`: activation, commands, persistence, webviews, and VS Code adapters.
- `src/ui`: React app that runs inside the webview.

Architecture goal: keep maintainable logic outside VS Code where possible, and make external API boundaries explicit.

[Back](INDEX.md)

[Back](INDEX.md)

# VS Code Extension

The VS Code layer lives in `src/vscode`, lifecycle composition lives in `src/extension`, and the entry point is `src/Extension.ts`.

Responsibilities:

- register views and commands.
- render webviews.
- receive messages from React.
- connect handlers with settings, history, DeepSeek, and tools.
- adapt VS Code APIs so `application` does not depend on them.
- upload and cache image attachments while exposing only protocol-safe metadata to React.

The final bundle is generated at `dist/extension.js`.

[Back](INDEX.md)

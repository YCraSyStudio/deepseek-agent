[Back](INDEX.md)

# Activation and Contributions

## Entry

`package.json` declares:

- `main`: `./dist/extension.js`.
- activity bar container: `deepseek-agent-sidebar`.
- webview view: `deepseek-agent.chatView`.
- commands: `deepseek-agent.openChat`, `deepseek-agent.addSelectionToChat`.

VS Code automatically generates activation events from those contributions. Do not keep a manual `activationEvents` list unless there is a specific reason.

## `activate(context)`

`src/Extension.ts` should:

- create `WebviewProvider`.
- register it in `ExtensionRuntime` and await history/checkpoint initialization.
- register `WebviewProvider.viewType`.
- register commands.
- add disposables to `context.subscriptions`.

`GenerationExecutor` creates one immutable `VsCodeToolWorkspace` from the conversation binding when each generation starts and scopes it through `AsyncLocalStorage`; activation does not install a mutable process-wide workspace root.

## `deactivate()`

It awaits `shutdownActiveProvider()`. Shutdown checkpoints active work, cancels tool sessions and generation controllers, flushes checkpoint writes, and disposes the provider before clearing runtime references.

[Back](INDEX.md)

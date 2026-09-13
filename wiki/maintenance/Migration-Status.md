[Back](INDEX.md)

# Migration Status

## Current state

- The extension compiles from `src`.
- The main output is `dist/extension.js`.
- The webview builds from `src/ui`.
- Public configuration is DeepSeek-only.
- Human documentation lives in `web-doc` with Astro and has English, Spanish, and Chinese routes.
- Technical documentation lives in the repository `wiki/` directory.
- Marketplace metadata, README, MIT license, and VSIX packaging track the version declared in `package.json`.
- Legacy single-origin API credentials migrate to a versioned per-origin Secret
  Storage bundle without exposing the stored value to the webview.
- Conversations require `schemaVersion: 2`, a complete workspace binding, and current context-summary data. The compatibility window tracked by [issue #61](https://github.com/YCraSyStudio/deepseek-agent/issues/61) ended in `0.1.11`: activation deletes every incompatible JSON conversation and its segments without interpreting or migrating it.
- Generation checkpoints require schema 3 and a complete workspace binding. Unsupported or malformed checkpoint files are deleted instead of migrated or quarantined.

## Watch list

- Legacy internal names such as `ProviderFactory`, `BaseProvider`, or `tabs/providers`.
- Historical messages such as `providers` if the UI stops needing them.
- Duplicated defaults between UI and backend.
- Ensure `core` remains free of `vscode` imports.
- Ensure new tools use `ToolWorkspace` and not direct VS Code APIs.
- Keep `web-doc/src/i18n/` as the source of translated documentation content.
- Do not reintroduce protocol compatibility for the removed `selectContextFiles` or `selectImageAttachments` requests; protocol 5 uses `selectAttachments`.

## Criteria for removing legacy compatibility

Remove a legacy piece when:

- it is not part of the active webview contract.
- it has no references in UI or handlers.
- it does not provide required compatibility with supported settings or credentials.
- compile and lint pass after removal.

Conversation compatibility met these criteria and was removed in `0.1.11`. Do not reintroduce the unversioned parser, workspace-state importer, legacy workspace binding, permission-mode checkpoint rewrite, or corrupt-record quarantine.

[Back](INDEX.md)

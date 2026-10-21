# YCraSy DeepSeek Agent

A DeepSeek-only coding assistant built for VS Code. Chat with DeepSeek, share workspace context, review its reasoning and tool activity, and let it work on your project under the permission mode you choose.

> **Release channels:** Version lines alternate by minor number. Even minor lines (`0.2.x`, `0.4.x`, ...) are stable; odd minor lines (`0.1.x`, `0.3.x`, ...) are pre-release builds that keep `preview: true`. The current line is `0.1.x`, so the extension is still under active development: updates on a pre-release line may change the conversation storage format and can make chats created by earlier `0.x` versions unavailable. Copy or export any conversation you need to keep before updating. Backward compatibility for saved chats becomes a release commitment on the first stable line (`0.2.x`), which is cut only once daily use stops surfacing errors.
>
> Review proposed workspace changes carefully and keep important project work under version control.

## Highlights

- Streaming chat with a chronological reasoning and tool timeline.
- File, search, patch, terminal, Git-context, and controlled web-search tools.
- Native image understanding through **DeepSeek V4.1 Flash** (`deepseek-flash`), which reads DeepSeek Files API image references directly in chat and in tool rounds.
- Three permission modes: confirmation-first, automatic with elevated-action confirmation, and full access with critical-action confirmation.
- One attachment action for context files and images, plus image paste with `Ctrl+V`/`Cmd+V`.
- Workspace path autocomplete with `./` and exact editor selections.
- Workspace-aware conversation history, configurable retention, and undo for deletions.
- Concurrent generations remain isolated by conversation; switching chats never redirects background output.
- **Stop** preserves the submitted prompt, partial response, reasoning, and completed tool results as a terminal cancelled turn. Completed side effects are never rolled back.
- API credentials stored per API origin in VS Code Secret Storage.
- English, Spanish, and Chinese interface localization.

## Requirements

- VS Code 1.131.0 or newer.
- A [DeepSeek API key](https://platform.deepseek.com/api_keys).
- Network access to the configured DeepSeek API endpoint.

## Get started

1. Install the extension and open **YCraSy DeepSeek Agent** from the Activity Bar.
2. Open **Settings** in the chat view and enter your DeepSeek API key.
3. Pick generation options and a permission mode. Chat runs on **DeepSeek V4.1 Flash**.
4. Send a message. Type `./` to reference workspace paths, attach a file or image with `+`, paste an image, or include an editor selection from VS Code.

## Documentation

- [User documentation](https://ycrasystudio.github.io/deepseek-agent/en/)
- [Documentación en español](https://ycrasystudio.github.io/deepseek-agent/es/)
- [中文文档](https://ycrasystudio.github.io/deepseek-agent/zh/)
- [Technical wiki](wiki/INDEX.md)
- [Release notes](CHANGELOG.md)
- [Release channels and versioning](wiki/maintenance/Beta-Publishing.md)
- [Report a bug or request a feature](https://github.com/YCraSyStudio/deepseek-agent/issues)

## Optional beta features

Enable **Settings → General → Beta features** to use DeepSeek's beta capabilities. The switch is off by default. It enables strict function schemas and gives the coding agent a `complete_code` tool with two modes: continue an assistant prefix (optionally with caller-supplied reasoning in thinking mode), or fill the gap between a code prefix and suffix with FIM. For example, ask the agent to fill a missing function body with FIM. Completions return text; normal edit tools still apply changes under your selected permissions.

These requests use the same configured API origin and credential with the `/beta` path. Agent-requested FIM and prefix completions are limited to 4,096 output tokens or your lower configured limit, default to 1,024, and appear in the conversation usage breakdown. Disabling the switch blocks new beta tool rounds and code completions and cancels interactive suggestions. Turning beta on makes the completion tool available to new generations. The API base URL setting itself is not changed.

## Editor and chat suggestions

Enable **Beta features** and use the separate **Editor suggestions** and **Chat suggestions** switches in General settings. Both are selected by default when beta is enabled. The editor offers native gray inline code suggestions using FIM; the chat input offers a continuation of your draft at its end. **Tab** accepts and **Escape** dismisses. Chat path suggestions (`./`) take priority, and Enter sends only the draft you have accepted or typed.

Requests begin after a short typing pause (700 ms in the editor, 800 ms in chat), use bounded surrounding code or the current chat draft, disable thinking, and cap output at 256/96 tokens respectively. Editing again cancels pending suggestions; stale responses are ignored, repeated contexts are cached, and API failures trigger a cooldown. Requests are billed by the configured API provider. The DeepSeek status-bar tooltip reports interactive completion/action usage for the current session separately from conversation usage. Automatic suggestions require a trusted workspace; secret-file names and non-code editors are excluded.

Right-click in a code editor → **YCraSy DeepSeek Agent → Complete / Refactor**. A selection takes priority; with no selection, a blank line targets the whole file, otherwise the smallest symbol containing the caret is used (with a statement/line fallback when the language supplies no symbols). Targets over 128 KiB must be narrowed. Review the proposed replacement in a diff and choose **Apply** or **Discard**; applying creates a normal undoable edit and refuses to overwrite a changed document. Complete requires beta; Refactor uses the stable API and also works with beta off. These explicit actions are capped at 4,096 output tokens and reject incomplete replacements.

## Privacy and safety

YCraSy DeepSeek Agent does not collect usage telemetry. To provide its features, the extension transmits prompts, selected context, tool results, images and related conversation data to the configured API provider. Those requests and responses are subject to the provider's privacy policy and API terms.

**Settings → General → Privacy** offers best-effort metadata minimization, enabled by default. It omits absolute workspace roots from generated runtime notices and review metadata, optional user identifiers and image filenames, and uses UTC timestamps without a named local time zone. Workspace-relative paths, root aliases and tool/file identifiers remain when needed for correct operation. The option does not rewrite existing history, scan or anonymize message/code/tool-output content, or remove image contents or embedded metadata.

Web search is global by default. You can select a country or Automatic to use the country in the local system locale. No public-IP lookup is performed and no IP address is added as a search localization parameter. The API provider still receives the connection's source IP and authentication information. A configured country is a relevance preference, not verified physical location.

This reduces avoidable metadata; it does not guarantee anonymity or GDPR compliance. Do not send confidential, personal, or regulated information unless the provider's terms meet your requirements. Images use DeepSeek's Files API and are referenced by file ID instead of embedding Base64 in chat history or provider messages.

Workspace tools follow the selected permission mode and VS Code Workspace Trust. Terminal commands are non-interactive but are not OS-sandboxed. Inspect tool calls carefully, especially when using unattended modes.

YCraSy DeepSeek Agent is an independent third-party extension. It is not affiliated with, endorsed by, sponsored by, or officially maintained by DeepSeek.

## License

[MIT](LICENSE)

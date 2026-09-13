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

## Privacy and safety

YCraSy DeepSeek Agent does not collect usage telemetry. Prompts, referenced content, uploaded images, conversation context, and generated responses sent to DeepSeek are handled under DeepSeek's current privacy policy and API terms. Images use DeepSeek's Files API and are referenced by file ID instead of embedding Base64 in chat history or provider messages. Do not send confidential, personal, or regulated information unless those terms meet your requirements.

Workspace tools follow the selected permission mode and VS Code Workspace Trust. Terminal commands are non-interactive but are not OS-sandboxed. Inspect tool calls carefully, especially when using unattended modes.

YCraSy DeepSeek Agent is an independent third-party extension. It is not affiliated with, endorsed by, sponsored by, or officially maintained by DeepSeek.

## License

[MIT](LICENSE)

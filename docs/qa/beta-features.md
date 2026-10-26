# Optional DeepSeek beta capabilities

`betaFeaturesEnabled` is stored with the extension settings and defaults to false. Settings → General exposes a localized toggle. The configured API origin, proxy prefix and credential remain unchanged; only beta chat/completion calls select the `/beta` path. Disabling selects stable chat even if the configured base URL previously ended in `/beta`.

## Implemented capabilities

- Chat Prefix Completion: the final message is an assistant text prefix with `prefix: true`. Optional caller-supplied `reasoning_content` requires thinking mode. The original API response is returned without guessing whether a prefix should be concatenated.
- FIM: `POST /beta/completions` receives a code `prompt`, optional `suffix`, bounded `max_tokens`, optional stop sequences and `stream: false`. Chat-only instructions, reasoning and tool fields are not sent to this endpoint.
- Strict function calling: all function schemas use `strict: true` on the beta chat endpoint. Objects are closed, all properties are required, unsupported length/item keywords are removed only from provider schemas, and optional fields use an `anyOf` branch with `enum: [null]`. Optional nulls are omitted before host validation and execution; required nulls and unknown arguments remain subject to rejection. Original host definitions remain unchanged.

The coding agent uses `complete_code` on demand. Separate beta-gated native editor suggestions (FIM, 700 ms, 256 tokens) and chat-draft suggestions (prefix, 800 ms, 96 tokens) now run while typing. Both can be switched off independently; Tab accepts, Escape dismisses, and ./ path completion wins in chat. Completions return text without applying changes. Normal edit tools retain their permission policy. Output defaults to 1,024 tokens and cannot exceed 4,096 or the configured lower limit. Requests have a 60-second overall deadline, propagate cancellation, do not retry POSTs and report usage under `code_completion`.

The tool is absent when beta is off. Disabling during a generation removes it from later rounds, blocks new completion requests and returns later tool rounds to the stable endpoint. In-flight requests may finish. Enabling exposes the completion tool to new generations. Normal thinking-mode reasoning history is not a beta feature and remains usable when the toggle is off.

## Verification and limits

API fixtures exercise endpoint selection, authentication, prefix/FIM bodies, thinking-prefix constraints, opt-in and live-disable guards, cancellation, token limits, malformed JSON, strict schema conversion for all built-in/web tools, optional-null normalization, streamed tool calls and host validation. These fixtures make no paid API requests. Live acceptance with a configured account, including server acceptance of strict nullable-enum schemas, remains a separate check; local fixtures do not prove the remote beta service's behavior.

Official documentation reviewed 21 October 2026:

- [Chat Prefix Completion](https://api-docs.deepseek.com/guides/chat_prefix_completion)
- [FIM Completion](https://api-docs.deepseek.com/guides/fim_completion)
- [Strict mode](https://api-docs.deepseek.com/guides/tool_calls#strict-mode-beta)
- [Chat API](https://api-docs.deepseek.com/api/create-chat-completion)
- [FIM API](https://api-docs.deepseek.com/api/create-completion)

The current OpenAI-compatible API documentation identifies these three beta capabilities. The beta reasoning-prefix input belongs to Chat Prefix Completion. The Anthropic compatibility API's Files beta header belongs to a different protocol and is not a separate OpenAI-compatible capability used by this extension.

## Interactive completion verification

- Unit fixtures cover beta/surface/trust gates, prefix/FIM routing, token/context limits, cache, cancellation, stale settings, failure cooldown, stable refactoring and rejecting truncated replacements.
- VS Code integration tests cover selection/innermost symbol/blank-line scope, native zero-width suggestions, stale document/caret rejection and cancellation/sensitive-file exclusions.
- Editor menu actions present a diff and apply only if the captured document version still matches, through an undoable editor edit.
- Interactive suggestions and editor menu actions use a session usage aggregate visible in the native status-bar tooltip, separate from conversation usage.

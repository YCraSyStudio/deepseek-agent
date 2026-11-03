# Optional DeepSeek beta capabilities

Settings → API → Beta features contains independent controls, all off by default. `betaFeaturesEnabled` enables prefix/FIM completions and their optional editor/chat suggestions. `strictToolCallsEnabled` separately opts tool rounds into strict schema validation. Enabling completions alone leaves ordinary chat, tools, connection checks and vision analysis on the stable API, even when the configured base URL ends in `/beta`. The original API origin, proxy prefix and credentials are preserved.

## Implemented capabilities

- Chat Prefix Completion: the final message is an assistant text prefix with `prefix: true`. Optional caller-supplied `reasoning_content` requires thinking mode. The original API response is returned without guessing whether a prefix should be concatenated.
- FIM: `POST /beta/completions` receives a code `prompt`, optional `suffix`, bounded `max_tokens`, optional stop sequences and `stream: false`. Chat-only instructions, reasoning and tool fields are not sent to this endpoint.
- Strict function calling: enabled only by the independent `strictToolCallsEnabled` toggle; all function schemas use `strict: true` on the beta chat endpoint. Objects are closed, all properties are required, unsupported length/item keywords are removed only from provider schemas, and optional fields use an `anyOf` branch containing their typed value schema and a nonempty closed object schema with the explicit boolean marker `__omit: true`. This marker represents omission and is removed before host validation and execution. Nulls from older responses remain accepted as omissions for optional arguments; required invalid values and unknown arguments remain subject to rejection. Zero-argument tools omit `parameters` entirely, as documented in the Chat Completions API. No provider object schema is empty. Original host definitions remain unchanged.

The coding agent uses `complete_code` on demand. Separate beta-gated native editor suggestions (FIM, 700 ms, 256 tokens) and chat-draft suggestions (prefix, 800 ms, 96 tokens) now run while typing. Both can be switched off independently; Tab accepts, Escape dismisses, and ./ path completion wins in chat. Completions return text without applying changes. Normal edit tools retain their permission policy. Output defaults to 1,024 tokens and cannot exceed 4,096 or the configured lower limit. Requests have a 60-second overall deadline, propagate cancellation, do not retry POSTs and report usage under `code_completion`.

The complete_code tool is absent when beta completions are off. Disabling completions during a generation removes it from later rounds and blocks new completion requests. It does not change strict tool calling. Disabling strict tool calling returns subsequent tool rounds to the stable endpoint; ordinary chat without tools always uses the stable endpoint. In-flight requests may finish. Enabling exposes the completion tool to new generations. Normal thinking-mode reasoning history is not a beta feature and remains usable when the toggle is off.

## Verification and limits

API fixtures exercise endpoint selection, authentication, prefix/FIM bodies, thinking-prefix constraints, opt-in and live-disable guards, cancellation, token limits, malformed JSON, strict schema conversion for all built-in/web tools, optional-argument normalization, streamed tool calls and host validation. These fixtures make no paid API requests. The full tool catalog is checked in both direct and streamed request payloads. Live acceptance with a configured account remains a separate check; local fixtures do not prove the remote beta service's behavior.

Official documentation reviewed 30 October 2026:

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

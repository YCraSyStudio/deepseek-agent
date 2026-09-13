[Back](INDEX.md)

# Tool Calls

Official references:

- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [Vision](https://api-docs.deepseek.com/guides/vision)

Key files:

- `src/application/chat/toolCall/ToolCallCycle.ts`
- `src/infrastructure/deepseek/provider/features/toolCall/ToolCallRequest.ts`
- `src/infrastructure/deepseek/provider/features/toolCall/ToolCallStreaming.ts`
- `src/vscode/webviews/handlers/chat/toolCalls/ToolCallSession.ts`

## Cycle

1. DeepSeek receives currently enabled function definitions.
2. The response may end with `finish_reason: "tool_calls"` and JSON-string arguments.
3. The host parses and validates the call, applies the permission policy, and requests confirmation when required.
4. Calls in one round execute sequentially. An identical name-and-argument call is skipped only while no successful workspace mutation has occurred since its previous execution.
5. Each result returns as `role: "tool"` with the original `tool_call_id`.
6. Tool execution has no artificial round or per-block call limit. It continues until a final response, cancellation, context/output boundary, or error.
7. At 20 completed tool rounds, and every 5 rounds thereafter, a separate tool-free progress reviewer evaluates recent context plus a compact cumulative activity history. It compares that history with the original request, treats self-initiated optional test/debug loops as finalization evidence once the requested deliverables build, and asks the primary model to stop tools and summarize. Its `finalize`, `blocked`, or `continue` decision becomes guidance for the next normal round, while uncertain or unavailable reviews continue safely.
8. Only complete `assistant(tool_calls) -> tool results -> assistant` sequences are replayed to the provider.

## Strict mode

DeepSeek strict tool validation is currently beta and requires `https://api.deepseek.com/beta`, `strict: true` for every function, and a compatible JSON Schema subset. The extension validates schemas and arguments locally, but stable-endpoint transport omits the beta-only `strict` field. Do not enable it on the stable base URL without a separately tested beta transport.

## Persistence and cancellation

The webview receives the presentation timeline, never the hidden canonical transcript. A cancelled turn keeps completed tool cards and results visible, but an incomplete provider tool protocol is excluded from future replay. Tool cancellation is terminal and cannot later change to completed or mutate another generation.

[Back](INDEX.md)

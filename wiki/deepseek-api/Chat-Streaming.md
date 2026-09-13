[Back](INDEX.md)

# Chat Streaming

Official references:

- [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [Vision](https://api-docs.deepseek.com/guides/vision)

Main path:

- `src/infrastructure/deepseek/provider/DeepSeekProvider.ts`
- `src/infrastructure/deepseek/provider/features/Chat.ts`
- `src/vscode/webviews/handlers/chat/streaming/Streaming.ts`
- `src/vscode/webviews/handlers/chat/generation/GenerationExecutor.ts`
- `src/vscode/webviews/handlers/chat/generation/GenerationRunFactory.ts`
- `src/vscode/webviews/handlers/chat/generation/GenerationRunFinalizer.ts`

## Flow

1. `GenerationCoordinator` starts a queued task with a unique `generationId` and `AbortController`.
2. `GenerationContext` builds a bounded provider transcript. Vision user messages may contain file-ID content blocks.
3. The provider sends `POST /chat/completions` with `stream: true`.
4. Content and `reasoning_content` deltas are normalized, correlated to conversation and generation, and rendered progressively.
5. Tool rounds append complete assistant/tool protocol messages to the host-only canonical transcript.
6. Progress is checkpointed. Persistence records `completed`, `cancelled`, `interrupted`, or `error`.
7. `GenerationRunFinalizer` reconciles persistence, usage, and checkpoints before publishing one terminal event.

The provider performs no hidden retry or model rewriting: one request reaches the configured endpoint, and its failure is surfaced without omitting previously sent image references or turning the failure into invented visual output.

## DeepSeek contract

- SSE ends with `data: [DONE]`.
- Reasoning is separate from visible content in thinking mode.
- When a thinking response calls tools, its `reasoning_content` is retained with the assistant tool-call message.
- Tool use remains supported when thinking is disabled.
- Usage may include prompt, completion, cache hit/miss, and reasoning tokens.

## Cancellation

`cancelGeneration` aborts only its named run. Explicit Stop preserves the submitted user message and all available assistant timeline data as a terminal `cancelled` turn. Completed tool effects and results remain recorded; no rollback is attempted. A later message gets a fresh cancellation scope.

`steerGeneration` is intentionally different: it queues guidance first and terminates the current turn as `interrupted` so a continuation can use bounded partial context. Host shutdown also uses interruption/recovery semantics rather than pretending the user pressed Stop.

Errors before acceptance use `requestRejected`; identified run failures use `streamError`. API keys, credentials, and unbounded provider response bodies must never appear in surfaced errors.

[Back](INDEX.md)

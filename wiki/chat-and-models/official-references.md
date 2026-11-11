[Back](2.INDEX.MD)

# Official References

Primary source: [DeepSeek API Docs](https://api-docs.deepseek.com/).

## Quick start and models

- [Your First API Call](https://api-docs.deepseek.com/): base URL, authentication, and chat example.
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/): current stable models, context, output limits, features, and prices.
- [Token Usage](https://api-docs.deepseek.com/quick_start/token_usage): token accounting.
- [Rate Limit](https://api-docs.deepseek.com/quick_start/rate_limit): limits and isolation.
- [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes): HTTP failures and handling.

## Guides

- [Vision](https://api-docs.deepseek.com/guides/vision): `deepseek-flash`, supported images, Files API references, and file content blocks.
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode): `thinking`, reasoning effort, `reasoning_content`, and tool interaction.
- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls): function calls and beta strict mode.
- [Multi-round Conversation](https://api-docs.deepseek.com/guides/multi_round_chat): message concatenation.
- [JSON Output](https://api-docs.deepseek.com/guides/json_mode): JSON response mode.
- [Context Caching](https://api-docs.deepseek.com/guides/kv_cache): cache hit/miss behavior.
- [FIM Completion Beta](https://api-docs.deepseek.com/guides/fim_completion): beta completion endpoint.

## API reference

- [API Reference](https://api-docs.deepseek.com/api/deepseek-api): Bearer authentication and endpoints.
- [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion): `/chat/completions`.
- [Create FIM Completion](https://api-docs.deepseek.com/api/create-completion): completion/FIM.
- [List Models](https://api-docs.deepseek.com/api/list-models): available-model discovery.

## Rules reflected in this project

- Images are uploaded to the Files API and referenced in chat by `file_id`; Base64 is not part of stored or provider messages.
- Vision accepts JPEG, PNG, GIF, and WebP. The extension verifies signatures before upload.
- Thinking can be disabled without removing tools.
- Tool arguments are JSON strings and are host-validated before execution.
- Thinking tool turns retain `reasoning_content` in their canonical protocol sequence.
- Strict tool mode is beta-only and must not be sent to the stable endpoint.
- Provider capabilities are time-sensitive; verify these links when changing identifiers, schemas, limits, or prices.

[Back](2.INDEX.MD)

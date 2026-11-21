[Back](INDEX.md)

# DeepSeek API

The AI integration lives in `apps/vscode/src/infrastructure/deepseek` and is exclusive to DeepSeek.

Responsibilities:

- build requests compatible with DeepSeek.
- run chat completion and streaming.
- keep FIM unavailable until a dedicated beta endpoint and request contract are implemented.
- support tool calls.
- upload, reference, and delete images through the DeepSeek Files API.
- provide DeepSeek V4.1 Flash vision by sending DeepSeek Files API references directly.
- map HTTP/SSE errors into errors handlers can consume.

Do not reintroduce `Ollama`, a multiprovider selector, or placeholders for other providers.

## External reference

The source of truth for the HTTP contract is the official documentation:

- [DeepSeek API Docs](https://api-docs.deepseek.com/)
- [API Reference](https://api-docs.deepseek.com/api/deepseek-api)
- [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
- [Vision and Files API](https://api-docs.deepseek.com/guides/vision)

Before changing request/response parameters, review those pages and update [Official references](Official-References.md).

[Back](INDEX.md)

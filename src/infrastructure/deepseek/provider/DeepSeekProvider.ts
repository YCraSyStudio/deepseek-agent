import {
  MODEL_REGISTRY,
  type AppConfig,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type StreamChunk,
} from "@/contracts";
import type { ModelProvider } from "@/application/ports";
import { chatCompletion, chatCompletionStream, buildChatBody, type ChatRequest } from "./features/Chat";
import { listModels } from "./Models";

export class DeepSeekModelProvider implements ModelProvider {
  public readonly name = "DeepSeek";
  public readonly id = "deepseek";

  constructor(private config: AppConfig) {}

  async chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse> {
    assertCompatibleModel(request.model || this.config.model, this.config.baseUrl);
    const chatRequest = this._applyDefaults(request);
    const body = buildChatBody(chatRequest, this.config);
    const preparedRequest = { ...chatRequest, ...body } as ChatRequest;
    return chatCompletion(preparedRequest, this.config.apiKey, this.config.baseUrl, signal);
  }

  async chatCompletionStream(request: ChatCompletionRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    assertCompatibleModel(request.model || this.config.model, this.config.baseUrl);
    const chatRequest = this._applyDefaults(request);
    const body = buildChatBody(chatRequest, this.config);

    const preparedRequest = { ...chatRequest, ...body } as ChatRequest;
    await this._stream(preparedRequest, onChunk, signal);
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      assertCompatibleModel(this.config.model, this.config.baseUrl);
      await this.chatCompletion({
        model: this.config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 2,
        thinking: { type: "disabled" },
      });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    const models = await listModels(this.config.apiKey, this.config.baseUrl);
    return models.map((m) => ({ id: m.id, name: m.id }));
  }

  updateConfig(config: Partial<AppConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private async _stream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    await chatCompletionStream({
      request,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      onChunk,
      signal,
    });
  }

  private _applyDefaults(req: ChatCompletionRequest): Partial<ChatRequest> {
    const deepSeekRequest = req as Partial<ChatRequest>;

    return {
      model: req.model || this.config.model,
      messages: req.messages,
      stream: req.stream,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      thinking: req.thinking,
      reasoning_effort: req.reasoning_effort,
      stop: req.stop,
      tools: req.tools,
      tool_choice: req.tool_choice,
      user_id: deepSeekRequest.user_id,
    };
  }
}

export function assertCompatibleModel(model: string, baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.origin !== "https://api.deepseek.com") {
    return;
  }
  if (!MODEL_REGISTRY.some((entry) => entry.id === model)) {
    throw new Error(`Model "${model}" is not supported by the official DeepSeek API configuration.`);
  }
}

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
} from "@/contracts/deepseek/Chat";
import type { AppConfig } from "@/contracts/Config";

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse>;
  chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  testConnection(): Promise<{ success: boolean; error?: string }>;
  listModels(): Promise<Array<{ id: string; name: string }>>;
}

export interface ModelProviderFactory {
  create(config: AppConfig): ModelProvider;
}

import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import type { ChatMessage } from "@/contracts";
import { getTextContent } from "@/contracts/deepseek/Chat";

export class QuickChatError extends Error {
  constructor(readonly reason: "busy" | "missingKey" | "providerError" | "emptyAnswer") {
    super(reason);
  }
}

export class QuickChatSession {
  private readonly messages: ChatMessage[] = [];
  private chatting = false;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly secrets: SecretStore,
    private readonly models: ModelProviderFactory,
  ) {}

  get transcript(): readonly ChatMessage[] {
    return [...this.messages];
  }

  async send(prompt: string, signal: AbortSignal): Promise<string> {
    if (this.chatting) {throw new QuickChatError("busy");}
    this.chatting = true;
    try {
      const config = this.settings.load();
      const apiKey = await this.secrets.getApiKey(config.baseUrl);
      if (!apiKey) {throw new QuickChatError("missingKey");}
      signal.throwIfAborted();
      const user: ChatMessage = { role: "user", content: prompt.trim() };
      const completion = await this.models.create({ ...config, apiKey }).chatCompletion({
        model: config.model,
        messages: [...this.messages, user],
        max_tokens: Math.min(config.maxTokens, 2048),
      }, signal).catch(() => {
        signal.throwIfAborted();
        throw new QuickChatError("providerError");
      });
      signal.throwIfAborted();
      const answer = getTextContent(completion.choices[0]?.message.content);
      if (!answer) {throw new QuickChatError("emptyAnswer");}
      this.messages.push(user, { role: "assistant", content: answer });
      if (this.messages.length > 12) {this.messages.splice(0, 2);}
      return answer;
    } finally {
      this.chatting = false;
    }
  }
}

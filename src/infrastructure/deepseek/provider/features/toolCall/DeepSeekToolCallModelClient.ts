import type { ChatMessage } from "@/contracts";
import { HistoricalFileRecovery } from "../MissingHistoricalFiles";
import type { ToolCallModelClient } from "@/application/chat/toolCall/ToolCallTypes";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { chatCompletion } from "../Chat";
import { buildToolCallRequest } from "./ToolCallRequest";
import { streamToolCallRound } from "./ToolCallStreaming";
import { normalizeBetaToolMessages } from "../StrictTools";

export function createDeepSeekToolCallModelClient(
  apiKey: string,
  baseUrl: string,
  initialMessages?: ChatMessage[],
): ToolCallModelClient {
  const historicalFiles = new HistoricalFileRecovery(initialMessages);
  return {
    async completeRound(options) {
      let usage: ProviderUsage | undefined;
      const strictEnabled = options.tools.length > 0 && options.cycleOptions.strictToolCallsEnabled === true && (options.cycleOptions.isStrictToolCallsEnabled?.() ?? true);
      try {
        const response = await chatCompletion(
          buildToolCallRequest({
            model: options.model,
            messages: options.messages,
            tools: options.tools,
            stream: false,
            cycleOptions: options.cycleOptions,
          }),
          apiKey,
          baseUrl,
          options.cycleOptions.signal,
          strictEnabled,
          historicalFiles,
        );
        usage = response.usage;
        return !strictEnabled ? response : {
          ...response,
          choices: response.choices.map((choice) => ({ ...choice, message: normalizeBetaToolMessages([choice.message], options.tools)[0] })),
        };
      } finally {
        options.cycleOptions.budgetManager?.recordPromptUsage(options.messages, options.tools, usage);
        options.cycleOptions.budgetManager?.recordRequestContext(options.messages, options.tools, usage);
        options.cycleOptions.onUsage?.(usage);
      }
    },
    streamRound(options) {
      return streamToolCallRound({
        ...options,
        apiKey,
        baseUrl,
        historicalFiles,
      });
    },
  };
}

import type { ToolCallModelClient } from "@/application/chat/toolCall/ToolCallTypes";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { chatCompletion } from "../Chat";
import { buildToolCallRequest } from "./ToolCallRequest";
import { streamToolCallRound } from "./ToolCallStreaming";
import { normalizeBetaToolMessages } from "../StrictTools";

export function createDeepSeekToolCallModelClient(
  apiKey: string,
  baseUrl: string,
): ToolCallModelClient {
  return {
    async completeRound(options) {
      let usage: ProviderUsage | undefined;
      const betaEnabled = options.cycleOptions.betaFeaturesEnabled === true && (options.cycleOptions.isBetaFeaturesEnabled?.() ?? true);
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
          betaEnabled,
        );
        usage = response.usage;
        return !betaEnabled ? response : {
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
      });
    },
  };
}

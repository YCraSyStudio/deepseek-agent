import type { ToolCallModelClient } from "@/application/chat/toolCall/ToolCallTypes";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { chatCompletion } from "../Chat";
import { buildToolCallRequest } from "./ToolCallRequest";
import { streamToolCallRound } from "./ToolCallStreaming";

export function createDeepSeekToolCallModelClient(
  apiKey: string,
  baseUrl: string,
): ToolCallModelClient {
  return {
    async completeRound(options) {
      let usage: ProviderUsage | undefined;
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
        );
        usage = response.usage;
        return response;
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

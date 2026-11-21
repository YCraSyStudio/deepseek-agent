import type { AppConfig, ChatCompletionRequest } from "@/contracts";
import type { CodeCompletionRequest } from "@/contracts/CodeCompletion";
import { getTextContent } from "@/contracts/deepseek/Chat";
import { deepseekFetch } from "@/infrastructure/deepseek/client/DeepSeekFetch";
import { resolveDeepSeekApiBaseUrl } from "@/infrastructure/deepseek/client/BetaFeatures";
import { MAX_METADATA_RESPONSE_BYTES, readBoundedJson } from "@/infrastructure/deepseek/client/BoundedResponseJson";
import { isRecord } from "@/shared/utils/TypeGuards";
import { parseProviderUsage, type ProviderUsage } from "@/shared/usage/Usage";
import { chatCompletion } from "./Chat";

export function createBetaCodeCompleter(
  config: AppConfig,
  isEnabled: () => boolean,
  onUsage: (usage: ProviderUsage | undefined, model: string) => void,
): (request: CodeCompletionRequest, signal?: AbortSignal) => Promise<string> {
  return async (request, signal) => {
    if (!config.betaFeaturesEnabled || !isEnabled()) {throw new Error("DeepSeek beta features are disabled.");}
    signal?.throwIfAborted();
    if (!config.apiKey.trim()) {throw new Error("No API key is configured for code completion.");}
    const requestedTokens = request.maxTokens ?? 1024;
    if (!Number.isInteger(requestedTokens) || requestedTokens < 1 || requestedTokens > 4096) {throw new Error("Code completion max_tokens must be between 1 and 4096.");}
    const maxTokens = Math.min(requestedTokens, config.maxTokens);
    if (request.reasoningPrefix && !config.thinkingMode) {throw new Error("A reasoning prefix requires thinking mode.");}
    signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    let usage: ProviderUsage | undefined;
    try {
      let content: string;
      let finishReason: unknown;
      if (request.mode === "prefix") {
        const body: ChatCompletionRequest = {
          model: config.model,
          messages: [
            { role: "user", content: request.instruction || "Complete the following code prefix. Return only the continuation." },
            { role: "assistant", content: request.prefix, prefix: true,
              ...(request.reasoningPrefix ? { reasoning_content: request.reasoningPrefix } : {}) },
          ],
          max_tokens: maxTokens,
          thinking: { type: config.thinkingMode ? "enabled" : "disabled" },
          ...(config.thinkingMode && config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
          ...(request.stop?.length ? { stop: request.stop } : {}),
        };
        const response = await chatCompletion(body, config.apiKey, config.baseUrl, signal, true);
        usage = response.usage;
        content = getTextContent(response.choices[0]?.message.content);
        finishReason = response.choices[0]?.finish_reason;
      } else if (request.mode === "fim") {
        const baseUrl = resolveDeepSeekApiBaseUrl(config.baseUrl, true);
        const response = await deepseekFetch({ baseUrl, pathOrUrl: "completions", apiKey: config.apiKey,
          requestInit: { method: "POST", signal, body: JSON.stringify({ model: config.model, prompt: request.prefix,
            ...(request.suffix ? { suffix: request.suffix } : {}), max_tokens: maxTokens, stream: false,
            ...(request.stop?.length ? { stop: request.stop } : {}) }) },
        });
        const value = await readBoundedJson(response, MAX_METADATA_RESPONSE_BYTES).catch((error: unknown) => {
          if (error instanceof SyntaxError) {throw new Error("DeepSeek returned invalid FIM JSON.");}
          throw error;
        });
        if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0]) || typeof value.choices[0].text !== "string") {
          throw new Error("DeepSeek returned an invalid FIM completion.");
        }
        usage = parseProviderUsage(value.usage);
        content = value.choices[0].text;
        finishReason = value.choices[0].finish_reason;
      } else {throw new Error("Unknown code completion mode.");}
      signal?.throwIfAborted();
      if (!["stop", "length"].includes(String(finishReason))) {throw new Error("DeepSeek did not complete the code request successfully.");}
      if (!content || Buffer.byteLength(content, "utf8") > 64 * 1024) {throw new Error("DeepSeek returned empty or oversized code.");}
      return JSON.stringify({ kind: "code_completion", mode: request.mode, content, finish_reason: finishReason,
        ...(request.mode === "prefix" ? { prefix: request.prefix } : {}),
      });
    } finally {onUsage(usage, config.model);}
  };
}

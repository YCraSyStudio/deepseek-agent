import type { AppConfig, ImageAttachment } from "@/contracts";
import { DEEPSEEK_FLASH_MODEL_ID, DEEPSEEK_PRO_MODEL_ID } from "@/contracts/deepseek/Models";
import { getTextContent } from "@/contracts/deepseek/Chat";
import type { ModelProviderFactory } from "@/application/ports";
import { recordUsage } from "@/shared/usage/Usage";
import type { UsageAggregate } from "@/shared/usage/UsageModels";

export type DelegatedVisionAnalyzer = (
  question: string,
  imageIds: string[],
  signal?: AbortSignal,
) => Promise<string>;

interface DelegatedVisionAnalyzerOptions {
  attachments?: ImageAttachment[];
  providerConfig: AppConfig;
  modelProviderFactory: ModelProviderFactory;
  usageAggregate: UsageAggregate;
}

/** Creates the Pro-only adapter that delegates attached images to DeepSeek V4.1 Flash. */
export function createDelegatedVisionAnalyzer({
  attachments = [],
  providerConfig,
  modelProviderFactory,
  usageAggregate,
}: DelegatedVisionAnalyzerOptions): DelegatedVisionAnalyzer | undefined {
  if (providerConfig.model !== DEEPSEEK_PRO_MODEL_ID || attachments.length === 0) {
    return undefined;
  }

  return async (question, imageIds, signal) => {
    const selectedIds = new Set(imageIds);
    const selected = selectedIds.size > 0
      ? attachments.filter((attachment) => selectedIds.has(attachment.id))
      : attachments;
    if (selected.length === 0) {
      throw new Error("None of the requested image IDs belongs to the current user message.");
    }
    if (selected.some((attachment) => attachment.expiresAt <= Date.now())) {
      throw new Error("One or more attached DeepSeek files have expired. Attach the images again.");
    }
    if (selected.some((attachment) => normalizeBaseUrl(attachment.apiBaseUrl) !== normalizeBaseUrl(providerConfig.baseUrl))) {
      throw new Error("The attached image was uploaded to a different DeepSeek API endpoint. Attach it again.");
    }

    const visionConfig: AppConfig = {
      ...providerConfig,
      model: DEEPSEEK_FLASH_MODEL_ID,
      thinkingMode: false,
      reasoningEffort: undefined,
      maxTokens: Math.min(providerConfig.maxTokens, 8_192),
    };
    const response = await modelProviderFactory.create(visionConfig).chatCompletion({
      model: visionConfig.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: question },
          ...selected.map((attachment) => ({ type: "file" as const, file_id: attachment.fileId })),
        ],
      }],
      stream: false,
      max_tokens: visionConfig.maxTokens,
      thinking: { type: "disabled" },
    }, signal);

    recordUsage(usageAggregate, "vision_analysis", response.usage, visionConfig.model);

    const content = getTextContent(response.choices[0]?.message.content).trim();
    if (!content) {
      throw new Error("DeepSeek V4.1 Flash returned an empty image analysis.");
    }
    return content;
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "").toLowerCase();
}

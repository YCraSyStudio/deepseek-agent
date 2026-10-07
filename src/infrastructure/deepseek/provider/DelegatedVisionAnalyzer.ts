import type { AppConfig, ImageAttachment } from "@/contracts";
import type { AnalyzeImagesRequest } from "@/application/tools/Types";
import { DEEPSEEK_FLASH_MODEL_ID, DEEPSEEK_PRO_MODEL_ID } from "@/contracts/deepseek/Models";
import { getTextContent } from "@/contracts/deepseek/Chat";
import type { ModelProviderFactory } from "@/application/ports";
import { recordUsage } from "@/shared/usage/Usage";
import type { UsageAggregate } from "@/shared/usage/UsageModels";
import { uploadDeepSeekImage, deleteDeepSeekFile } from "../files/DeepSeekFiles";
import { resolveVisionImageSources, MAX_VISION_BYTES } from "@/infrastructure/images/VisionImageSources";
import type { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { createHash } from "node:crypto";

export interface DelegatedVisionAnalyzer {
  (request: AnalyzeImagesRequest, signal?: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}
interface DelegatedVisionAnalyzerOptions {
  attachments?: ImageAttachment[];
  providerConfig: AppConfig;
  modelProviderFactory: ModelProviderFactory;
  usageAggregate: UsageAggregate;
  screenshots?: ScreenshotStore;
  upload?: typeof uploadDeepSeekImage;
  deleteFile?: typeof deleteDeepSeekFile;
}

/** Session-scoped uploads: reuse by SHA-256, delete when generation settles. */
export function createDelegatedVisionAnalyzer({ attachments = [], providerConfig, modelProviderFactory, usageAggregate, screenshots,
  upload = uploadDeepSeekImage, deleteFile = deleteDeepSeekFile,
}: DelegatedVisionAnalyzerOptions): DelegatedVisionAnalyzer | undefined {
  if (!([DEEPSEEK_PRO_MODEL_ID, DEEPSEEK_FLASH_MODEL_ID] as readonly string[]).includes(providerConfig.model)) {return undefined;}
  const uploads = new Map<string, { id: string; bytes: number }>();
  let disposed = false;
  const remove = (id: string) => deleteFile({ apiKey: providerConfig.apiKey, baseUrl: providerConfig.baseUrl, fileId: id });
  const analyze: DelegatedVisionAnalyzer = Object.assign(async (request: AnalyzeImagesRequest, signal?: AbortSignal) => {
    if (disposed) {throw new Error("Vision session is closed");}
    signal?.throwIfAborted();
    const sources = await resolveVisionImageSources(request, attachments, screenshots);
    if (!sources.attachments.length && !sources.local.length) {throw new Error("No images were selected");}
    if (sources.attachments.some((attachment) => attachment.expiresAt <= Date.now())) {throw new Error("Attached DeepSeek files have expired; attach them again");}
    if (sources.attachments.some((attachment) => normalizeBaseUrl(attachment.apiBaseUrl) !== normalizeBaseUrl(providerConfig.baseUrl))) {
      throw new Error("Image was uploaded to a different DeepSeek endpoint; attach it again");
    }
    const fileIds = sources.attachments.map((attachment) => attachment.fileId);
    const sentSources = [...sources.attachments.map((attachment) => `attachment:${attachment.id}`), ...sources.local.map((image) => image.source)];
    const pinned = new Set<string>();
    for (const image of sources.local) {
      const hash = createHash("sha256").update(image.bytes).digest("hex");
      let cached = uploads.get(hash);
      if (!cached) {
        while (uploads.size >= 16 || [...uploads.values()].reduce((sum, item) => sum + item.bytes, 0) + image.bytes.length > MAX_VISION_BYTES) {
          const oldest = [...uploads.entries()].find(([key]) => !pinned.has(key));
          if (!oldest) {throw new Error("Vision session cache limit exceeded");}
          await remove(oldest[1].id); uploads.delete(oldest[0]);
        }
        const file = await upload({ apiKey: providerConfig.apiKey, baseUrl: providerConfig.baseUrl, bytes: image.bytes,
          filename: image.name, mediaType: image.mediaType, expiresAfterSeconds: 3600, signal });
        cached = { id: file.id, bytes: image.bytes.length }; uploads.set(hash, cached);
      }
      pinned.add(hash);
      fileIds.push(cached.id);
    }
    signal?.throwIfAborted();
    const visionConfig: AppConfig = { ...providerConfig, model: DEEPSEEK_FLASH_MODEL_ID, thinkingMode: false, reasoningEffort: undefined, maxTokens: Math.min(providerConfig.maxTokens, 8192) };
    try {
      const response = await modelProviderFactory.create(visionConfig).chatCompletion({ model: visionConfig.model,
        messages: [{ role: "user", content: [{ type: "text", text: request.question }, ...fileIds.map((id) => ({ type: "file" as const, file_id: id }))] }],
        stream: false, max_tokens: visionConfig.maxTokens, thinking: { type: "disabled" },
      }, signal);
      recordUsage(usageAggregate, "vision_analysis", response.usage, visionConfig.model);
      const content = getTextContent(response.choices[0]?.message.content).trim();
      if (!content) {throw new Error("DeepSeek V4.1 Flash returned an empty image analysis");}
      return `Images sent: ${JSON.stringify(sentSources)}\n${content}`;
    } catch (error) {throw new Error(`Image analysis failed for ${JSON.stringify(sentSources)}: ${String(error)}`);}
  }, {
    async dispose() {
      disposed = true;
      const results = await Promise.allSettled([...uploads.values()].map((file) => remove(file.id)));
      uploads.clear();
      if (results.some((result) => result.status === "rejected")) {throw new Error("Some temporary vision uploads could not be deleted; their expiry is one hour");}
    },
  });
  return analyze;
}
function normalizeBaseUrl(value: string): string {return value.replace(/\/+$/, "").toLowerCase();}

import type { ContextWindowStatus } from "@/contracts";
import { ContextCompactor } from "@/application/chat/context/ContextCompaction";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { createUsageAggregate, recordUsage, summarizeConversationUsage } from "@/shared/usage/Usage";
import { isOfficialDeepSeekEndpoint } from "@/shared/usage/UsagePricing";
import type { SendMessagePayload } from "../Types";
import { estimatedContextWindow } from "./ContextWindow";
import { resolveAuxiliaryModel } from "@/application/chat/AuxiliaryModelPolicy";

interface ManualCompactionOptions {
  conversationState: ConversationState;
  coordinator: GenerationCoordinator<SendMessagePayload>;
  settings: SettingsRepository;
  secrets: SecretStore;
  modelProviderFactory: ModelProviderFactory;
  getSelectedConversationId: () => string | undefined;
  hasHistoryTransition: () => boolean;
  post: (message: Record<string, unknown>) => void;
}

export class ManualCompaction {
  private active?: AbortController;

  constructor(private readonly options: ManualCompactionOptions) {}

  async compact(requestId: string, conversationId?: string): Promise<void> {
    const selectedConversationId = this.options.getSelectedConversationId();
    if (!selectedConversationId || (conversationId !== undefined && conversationId !== selectedConversationId)) {
      this.fail(requestId, "Only the conversation that is open can be compacted.");
      return;
    }
    if (this.active) {
      this.fail(requestId, "A context compaction is already running.");
      return;
    }
    if (this.options.hasHistoryTransition()) {
      this.fail(requestId, "Wait for the pending history change to finish before compacting the context.");
      return;
    }
    if (
      this.options.coordinator.getActiveForConversation(selectedConversationId) ||
      this.options.coordinator.getQueue(selectedConversationId).length > 0
    ) {
      this.fail(requestId, "Wait for the running generation to finish before compacting the context.");
      return;
    }

    const units = this.options.conversationState.getApiContextUnits();
    if (units.length === 0) {
      this.options.post({ type: "contextCompactionResult", requestId, status: "empty" });
      return;
    }

    const config = this.options.settings.load();
    const apiKey = await this.options.secrets.getApiKey(config.baseUrl);
    if (!apiKey) {
      this.fail(requestId, "API key is not configured. Open Settings -> API Key.");
      return;
    }

    const controller = new AbortController();
    this.active = controller;
    try {
      const model = resolveAuxiliaryModel(config);
      const usage = createUsageAggregate(isOfficialDeepSeekEndpoint(config.baseUrl), model);
      const provider = this.options.modelProviderFactory.create({ ...config, apiKey, model });
      const compactor = new ContextCompactor(
        provider,
        model,
        controller.signal,
        undefined,
        (phase, providerUsage, actualModel) => recordUsage(usage, phase, providerUsage, actualModel),
      );
      const summary = await compactor.summarize(
        units,
        this.options.conversationState.getConversation()?.contextSummary,
      );
      await this.options.conversationState.saveContextSummary(summary);
      await this.options.conversationState.saveMessages({
        messages: [this.options.conversationState.createMessage("context", "Context compacted manually", {
          generationId: `manual-compaction:${requestId}`,
          ...(usage.count > 0 ? { usage } : {}),
        })],
        model: config.model,
      });
      this.postContextWindow(selectedConversationId, config.model, config.maxTokens);
      this.options.post({
        type: "conversationUsageUpdated",
        conversationId: selectedConversationId,
        usage: summarizeConversationUsage(this.options.conversationState.getConversation()?.messages ?? []),
      });
      this.options.post({
        type: "contextCompactionResult",
        requestId,
        status: "compacted",
        freedTokens: freedTokens(summary),
      });
    } catch (error) {
      this.fail(requestId, error instanceof Error ? error.message : String(error));
    } finally {
      this.active = undefined;
    }
  }

  dispose(): void {
    this.active?.abort();
    this.active = undefined;
  }

  private postContextWindow(conversationId: string, model: string, requestedOutputTokens: number): void {
    const contextWindow: ContextWindowStatus | undefined = estimatedContextWindow(
      this.options.conversationState,
      model,
      requestedOutputTokens,
    );
    if (contextWindow) {
      this.options.post({ type: "contextWindowUpdated", conversationId, contextWindow });
    }
  }

  private fail(requestId: string, error: string): void {
    this.options.post({ type: "contextCompactionResult", requestId, status: "failed", error });
  }
}

function freedTokens(summary: { boundaries?: Array<{ estimatedTokensBefore: number; estimatedTokensAfter: number }> }): number | undefined {
  const boundary = summary.boundaries?.at(-1);
  if (!boundary) {
    return undefined;
  }
  return Math.max(0, boundary.estimatedTokensBefore - boundary.estimatedTokensAfter);
}

import { ConversationState } from "@/application/chat/ConversationState";
import { buildInterruptedContextContent } from "@/application/chat/InterruptedContext";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import {
  type GenerationCheckpointStore,
  type HistoryManager,
} from "@/vscode/storage";
import type { SettingsRepository } from "@/application/ports";
import type { QueuedGenerationMessage } from "@/contracts";

export async function recoverGenerationCheckpoints(
  checkpointStore: GenerationCheckpointStore,
  historyManager: HistoryManager,
  recoveredDrafts: Map<string, QueuedGenerationMessage[]>,
  settings: SettingsRepository,
): Promise<void> {
  if (!settings.load().historyEnabled) {
    if (!settings.getPersistenceError()) {
      await checkpointStore.clearAll();
    }
    recoveredDrafts.clear();
    return;
  }
  const checkpoints = await checkpointStore.recover();
  for (const checkpoint of checkpoints) {
    if (checkpoint.queue.length > 0) {
      recoveredDrafts.set(checkpoint.conversationId, checkpoint.queue);
    }
    if (checkpoint.userMessage) {
      const existing = await historyManager.getById(checkpoint.conversationId);
      const state = new ConversationState(historyManager);
      if (existing) {
        state.load(existing);
      } else {
        const now = checkpoint.updatedAt;
        state.load({
          schemaVersion: 2,
          id: checkpoint.conversationId,
          title: "Recovered conversation",
          createdAt: now,
          updatedAt: now,
          messages: [],
          model: checkpoint.config?.model ?? settings.load().model,
          workspaceUri: checkpoint.workspaceUri,
          workspaceBinding: checkpoint.workspaceBinding,
        });
      }

      const existingMessages = state.getConversation()?.messages ?? [];
      const messages: StoredConversation["messages"] = [];
      if (!existingMessages.some((message) => message.id === checkpoint.userMessage?.id)) {
        messages.push({ ...checkpoint.userMessage, generationId: checkpoint.generationId });
      }
      if (
        !existingMessages.some(
          (message) =>
            message.role === "assistant" &&
            message.generationId === checkpoint.generationId,
        ) &&
        (
          checkpoint.content ||
          checkpoint.timeline.length > 0 ||
          checkpoint.toolCalls.length > 0 ||
          checkpoint.providerTranscript
        )
      ) {
        const completed =
          checkpoint.status === "completed" &&
          checkpoint.providerTranscript?.status === "complete";
        const recoveredToolCalls = checkpoint.toolCalls.map((tool) =>
          !completed &&
          (
            tool.status === "pending" ||
            tool.status === "awaiting_confirmation" ||
            tool.status === "running"
          )
            ? {
                ...tool,
                status: "cancelled" as const,
                result: tool.result ?? "Interrupted because VS Code closed.",
                requiresConfirmation: false,
                dangerConfirmation: undefined,
              }
            : tool,
        );
        messages.push(state.createMessage("assistant", checkpoint.content, {
          generationId: checkpoint.generationId,
          generationStatus: completed ? "completed" : "interrupted",
          timeline: checkpoint.timeline,
          contextContent: completed ? checkpoint.content : buildInterruptedContextContent(checkpoint.content, recoveredToolCalls),
          providerTranscript: completed ? undefined : checkpoint.providerTranscript,
          toolCalls: recoveredToolCalls,
        }));
      }
      if (messages.length > 0) {
        await state.saveMessages({
          messages,
          model: checkpoint.config?.model ?? settings.load().model,
        });
      }
    }
    await checkpointStore.delete(checkpoint.conversationId);
  }
}

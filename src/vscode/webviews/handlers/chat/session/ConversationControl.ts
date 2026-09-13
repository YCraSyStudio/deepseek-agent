import type * as vscode from "vscode";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator, GenerationStopReason } from "@/application/chat/GenerationCoordinator";
import type { ToolRegistry } from "@/application/tools";
import type { WebviewToHandlerMessage } from "@/contracts";
import type { SendMessagePayload } from "../Types";
import { transitionGenerationRun, type GenerationRunRecord } from "../generation/GenerationRun";
import { getAvailableToolMetadata } from "../toolCalls/ToolMetadata";
import { isTerminalGenerationState } from "@/domain/generation/GenerationState";

export function cancelGeneration(
  generationId: string,
  conversationId: string,
  coordinator: GenerationCoordinator<SendMessagePayload>,
  runs: Map<string, GenerationRunRecord>,
  reason: GenerationStopReason = "user_cancelled",
): boolean {
  const active = coordinator.getActive(generationId);
  if (!active || active.task.conversationId !== conversationId) {
    return false;
  }
  const effectiveReason = active.stopReason ?? reason;
  const record = runs.get(generationId);
  if (record && isTerminalGenerationState(record.status)) {
    return false;
  }
  if (record) {
    if (effectiveReason === "user_cancelled") {
      transitionGenerationRun(record, "cancelling");
    }
    record.session.cancel();
  }
  coordinator.interrupt(generationId, reason);
  return true;
}

export function steerGeneration(
  message: Extract<WebviewToHandlerMessage, { type: "steerGeneration" }>,
  coordinator: GenerationCoordinator<SendMessagePayload>,
  runs: Map<string, GenerationRunRecord>,
  enqueueAtFront: (payload: SendMessagePayload) => Promise<void>,
): void {
  const active = coordinator.getActive(message.generationId);
  if (!active || active.task.conversationId !== message.conversationId) {
    return;
  }
  void enqueueAtFront({
    clientRequestId: message.clientRequestId,
    text: message.text,
    modelId: message.modelId,
    reasoning: message.reasoning,
    conversationId: message.conversationId,
    workspaceRevision: message.workspaceRevision,
    referencedFiles: message.referencedFiles,
    imageAttachments: message.imageAttachments,
    steering: { sourceGenerationId: message.generationId },
  }).then(() => cancelGeneration(message.generationId, message.conversationId, coordinator, runs, "steered"));
}

export function postAvailableTools(
  webviewView: vscode.WebviewView,
  toolRegistry: ToolRegistry,
): void {
  void webviewView.webview.postMessage({
    type: "availableTools",
    tools: getAvailableToolMetadata(toolRegistry.getDefinitionsForAPI()),
  });
}

export function syncSelectedConversation(
  state: ConversationState,
  selectedConversationId: string | undefined,
  selectedState: ConversationState,
): void {
  if (state.getActiveConversationId() !== selectedConversationId) {
    return;
  }
  const conversation = state.getConversation();
  if (conversation) {
    selectedState.load(conversation);
  }
}

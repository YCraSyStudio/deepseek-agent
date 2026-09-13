import type { AppConfig, PermissionSnapshot } from "@/contracts";
import { ConversationState } from "@/application/chat/ConversationState";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import type { GenerationTask } from "@/application/chat/GenerationCoordinator";
import { ToolExecutor, type ToolRegistry } from "@/application/tools";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { HistoryManager } from "@/vscode/storage";
import type { WorkspaceRunSnapshot } from "@/vscode/workspace";
import type { SendMessagePayload } from "../Types";
import { ToolCallSession } from "../toolCalls/ToolCallSession";
import type { GenerationRunRecord } from "./GenerationRun";

interface CreateGenerationStateOptions {
  activeConversationState: ConversationState;
  config: AppConfig;
  historyManager: HistoryManager;
  task: GenerationTask<SendMessagePayload>;
  workspaceSnapshot: WorkspaceRunSnapshot;
}

export async function createGenerationState({
  activeConversationState,
  config,
  historyManager,
  task,
  workspaceSnapshot,
}: CreateGenerationStateOptions): Promise<ConversationState> {
  const sourceConversation = await historyManager.getById(task.conversationId) ??
    (
      activeConversationState.getActiveConversationId() === task.conversationId
        ? activeConversationState.getConversation()
        : undefined
    );
  const selectedMode = activeConversationState.getActiveConversationId() === task.conversationId
    ? activeConversationState.getPersistenceMode()
    : undefined;
  const state = new ConversationState(
    historyManager,
    selectedMode ?? (config.historyEnabled ? "persistent" : "incognito"),
  );

  if (sourceConversation) {
    state.load(sourceConversation);
    return state;
  }

  const now = Date.now();
  state.load({
    schemaVersion: 2,
    id: task.conversationId,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
    model: task.payload.modelId || config.model,
    workspaceUri: workspaceSnapshot.binding.uri,
    workspaceBinding: workspaceSnapshot.binding,
  });
  return state;
}

interface CreateGenerationRunRecordOptions {
  clientRequestId: string;
  config: AppConfig;
  conversationId: string;
  generationId: string;
  initialPermissionSnapshot: PermissionSnapshot;
  model: string;
  state: ConversationState;
  toolRegistry: ToolRegistry;
}

export function createGenerationRunRecord({
  clientRequestId,
  config,
  conversationId,
  generationId,
  initialPermissionSnapshot,
  model,
  state,
  toolRegistry,
}: CreateGenerationRunRecordOptions): GenerationRunRecord {
  const session = new ToolCallSession(new ToolExecutor(toolRegistry, () => {
    const host = getToolWorkspaceHost();
    return host.getWorkspaceId?.() ?? host.getRootPath() ?? "workspace:unknown";
  }));

  return {
    generationId,
    conversationId,
    clientRequestId,
    state,
    session,
    content: "",
    timeline: [],
    toolCalls: [],
    status: "starting",
    eventLog: [],
    permissionSnapshot: initialPermissionSnapshot,
    budgetManager: new GenerationBudgetManager(model, config.maxTokens),
  };
}

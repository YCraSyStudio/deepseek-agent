import type { ConversationState } from "@/application/chat/ConversationState";
import type { HistoryManager } from "@/vscode/storage";

export async function restoreRequestedConversation(
  conversationId: string | undefined,
  state: ConversationState,
  historyManager: HistoryManager,
  loadConversation: (conversation: NonNullable<ReturnType<ConversationState["getConversation"]>>) => void,
): Promise<void> {
  if (!conversationId || state.getActiveConversationId() === conversationId) {
    return;
  }
  const conversation = await historyManager.getById(conversationId);
  if (conversation) {
    loadConversation(conversation);
  } else {
    state.reset();
  }
}

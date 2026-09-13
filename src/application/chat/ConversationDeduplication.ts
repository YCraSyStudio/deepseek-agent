import type { Conversation } from "@/contracts";

export function findDuplicateConversationIds(conversations: Conversation[]): Set<string> {
  const preferred = [...conversations].sort((left, right) =>
    right.messages.length - left.messages.length || right.updatedAt - left.updatedAt,
  );
  const retained: Conversation[] = [];
  const duplicates = new Set<string>();

  for (const conversation of preferred) {
    const messageIds = conversation.messages.map((message) => message.id).filter(Boolean);
    const isFragment = messageIds.length > 0 && retained.some((candidate) => {
      if (candidate.workspaceUri !== conversation.workspaceUri || candidate.model !== conversation.model) {
        return false;
      }
      const candidateMessageIds = new Set(candidate.messages.map((message) => message.id));
      return messageIds.every((id) => candidateMessageIds.has(id));
    });

    if (isFragment) {
      duplicates.add(conversation.id);
    } else {
      retained.push(conversation);
    }
  }

  return duplicates;
}

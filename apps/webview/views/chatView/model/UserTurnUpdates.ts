import type { ConversationMessage } from "@/contracts";

export function upsertUserTurn(messages: ConversationMessage[], message: ConversationMessage): ConversationMessage[] {
  const index = message.generationId && message.role === "user"
    ? messages.findIndex((item) => item.role === "user" && item.generationId === message.generationId)
    : -1;
  if (index === -1) {return [...messages, message];}
  return messages.map((item, position) => position === index ? { ...item, ...message, id: item.id } : item);
}

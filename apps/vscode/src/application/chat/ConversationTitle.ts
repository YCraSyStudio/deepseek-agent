import type { ConversationMessage } from "@/contracts";

export function createConversationTitle(messages: ConversationMessage[], currentTitle?: string): string {
  const firstUserSummary = summarizeTitleSource(messages.find((message) => message.role === "user")?.content ?? "");
  if (firstUserSummary) {
    return firstUserSummary;
  }

  return currentTitle || "New conversation";
}

function summarizeTitleSource(content: string): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\*\*|__|[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? normalized;
}

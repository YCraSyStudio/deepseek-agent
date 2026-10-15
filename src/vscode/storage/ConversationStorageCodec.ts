import type { StoredConversationMessage } from "@/application/chat/ProviderTranscript";
import { isRecord } from "@/shared/utils/TypeGuards";

// Storage-only references. UI/model contracts remain fully expanded in memory.
export function encodeConversationMessage(message: StoredConversationMessage): unknown {
  return {
    ...message,
    contextContent: message.contextContent === message.content ? undefined : message.contextContent,
    imageAttachments: message.imageAttachments?.length ? message.imageAttachments : undefined,
    toolCalls: message.toolCalls?.length ? message.toolCalls : undefined,
    timeline: message.timeline?.length ? message.timeline.map((event) => {
      if (event.type === "content" && event.content === message.content) {
        return { id: event.id, type: event.type, contentRef: "message" };
      }
      return event;
    }) : undefined,
  };
}

export function decodeConversationMessage(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.timeline)) {return value;}
  return {
    ...value,
    timeline: value.timeline.map((event: unknown) => {
      if (!isRecord(event) || !("contentRef" in event)) {return event;}
      if (event.type !== "content" || event.contentRef !== "message" || "content" in event || typeof value.content !== "string") {
        throw new Error("Invalid stored timeline content reference");
      }
      return { id: event.id, type: "content", content: value.content };
    }),
  };
}

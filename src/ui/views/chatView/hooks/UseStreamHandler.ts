import { useCallback, useEffect, useRef } from "react";
import type { AssistantTimelineEvent } from "@/contracts";
import type { ChatMessage } from "../ChatViewTypes";

type TimelineTextEvent = Extract<AssistantTimelineEvent, { type: "reasoning" | "content" }>;
type TimelineToolGroupEvent = Extract<AssistantTimelineEvent, { type: "tool-group" }>;
const MAX_REASONING_CHARACTERS = 512 * 1024;
const MAX_PENDING_DELTA_CHARACTERS = 32 * 1024;

export function useStreamHandler() {
  const streamingMessageIdRef = useRef<string | null>(null);
  const pendingDeltasRef = useRef<Array<{ eventId: string; eventType: TimelineTextEvent["type"]; content: string; generationId?: string; setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>> }>>([]);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextMessageId = useCallback(() => crypto.randomUUID(), []);

  const resetStreaming = useCallback(() => {
    streamingMessageIdRef.current = null;
  }, []);

  const ensureStreamingAssistantMessage = useCallback(
    (setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, generationId?: string): string => {
      if (streamingMessageIdRef.current) {
        return streamingMessageIdRef.current;
      }

      const id = nextMessageId();
      streamingMessageIdRef.current = id;
      setMessages((current) => [...current, { id, role: "assistant", content: "", timeline: [], generationId }]);
      return id;
    },
    [nextMessageId],
  );

  const flushTimelineDeltas = useCallback(() => {
    if (frameRef.current !== null) {cancelAnimationFrame(frameRef.current);}
    if (timeoutRef.current !== null) {clearTimeout(timeoutRef.current);}
    frameRef.current = null;
    timeoutRef.current = null;
    const pending = pendingDeltasRef.current.splice(0);
    if (pending.length === 0) {return;}
    const setMessages = pending[0].setMessages;
    const generationId = pending.find((delta) => delta.generationId)?.generationId;
    const messageId = ensureStreamingAssistantMessage(setMessages, generationId);
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) {return message;}
      const timeline = [...(message.timeline ?? [])];
      let content = message.content;
      for (const delta of pending) {
        const index = timeline.findIndex((event) => event.id === delta.eventId);
        if (index >= 0) {
          const existing = timeline[index];
          if (existing.type === delta.eventType) {
            timeline[index] = {
              ...existing,
              content: delta.eventType === "reasoning"
                ? appendBoundedCharacters(existing.content, delta.content, MAX_REASONING_CHARACTERS)
                : existing.content + delta.content,
            };
          }
        } else {
          timeline.push({ id: delta.eventId, type: delta.eventType, content: delta.content });
        }
        if (delta.eventType === "content") {content += delta.content;}
      }
      return { ...message, content, timeline };
    }));
  }, [ensureStreamingAssistantMessage]);

  const appendTimelineDelta = useCallback(
    (
      eventId: string,
      eventType: TimelineTextEvent["type"],
      content: string,
      setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
      generationId?: string,
    ) => {
      if (!content) {
        return;
      }
      pendingDeltasRef.current.push({ eventId, eventType, content, generationId, setMessages });
      const pendingCharacters = pendingDeltasRef.current.reduce((total, delta) => total + delta.content.length, 0);
      if (pendingCharacters >= MAX_PENDING_DELTA_CHARACTERS) {
        flushTimelineDeltas();
        return;
      }
      if (frameRef.current === null) {frameRef.current = requestAnimationFrame(flushTimelineDeltas);}
      if (timeoutRef.current === null) {timeoutRef.current = setTimeout(flushTimelineDeltas, 50);}
    },
    [flushTimelineDeltas],
  );

  const appendTimelineToolGroup = useCallback(
    (event: TimelineToolGroupEvent, setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, generationId?: string) => {
      flushTimelineDeltas();
      const messageId = ensureStreamingAssistantMessage(setMessages, generationId);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId && !(message.timeline ?? []).some((item) => item.id === event.id)
            ? { ...message, timeline: [...(message.timeline ?? []), event] }
            : message,
        ),
      );
    },
    [ensureStreamingAssistantMessage, flushTimelineDeltas],
  );

  useEffect(() => () => {
    if (frameRef.current !== null) {cancelAnimationFrame(frameRef.current);}
    if (timeoutRef.current !== null) {clearTimeout(timeoutRef.current);}
    resetStreaming();
  }, [resetStreaming]);

  return {
    streamingMessageIdRef,
    nextMessageId,
    appendTimelineDelta,
    appendTimelineToolGroup,
    flushTimelineDeltas,
    resetStreaming,
  };
}

function appendBoundedCharacters(current: string, addition: string, maxCharacters: number): string {
  const combined = `${current}${addition}`;
  if (combined.length <= maxCharacters) {return combined;}
  const marker = "\n...[older reasoning omitted]...\n";
  const side = Math.floor((maxCharacters - marker.length) / 2);
  return `${combined.slice(0, side)}${marker}${combined.slice(-side)}`;
}

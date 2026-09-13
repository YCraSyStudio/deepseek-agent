import { randomUUID } from "crypto";
import type { AssistantTimelineEvent, ConversationMessage, StreamChunk } from "@/contracts";
import type { GenerationEventSink } from "@/application/ports";
import { appendBoundedUtf8 } from "@/shared/utils/BoundedText";

const MAX_RETAINED_REASONING_BYTES = 512 * 1024;

export interface StreamDonePayload {
  status?: "completed" | "cancelled" | "interrupted";
  finish_reason?: string;
  generationStopReason?: ConversationMessage["generationStopReason"];
}

export class StreamEventEmitter {
  private readonly timeline: AssistantTimelineEvent[] = [];
  private activeTextEvent: Extract<AssistantTimelineEvent, { type: "reasoning" | "content" }> | null = null;

  constructor(private readonly eventSink: GenerationEventSink<Record<string, unknown>>) {}

  showTyping(): void {
    void this.eventSink.publish({ type: "showTyping" });
  }

  chunk(content: string): void {
    this.text("content", content);
  }

  reasoning(content: string): void {
    this.text("reasoning", content);
  }

  toolGroup(round: number, toolCallIds: string[]): void {
    const event: Extract<AssistantTimelineEvent, { type: "tool-group" }> = {
      id: randomUUID(),
      type: "tool-group",
      round,
      toolCallIds: [...toolCallIds],
    };
    this.activeTextEvent = null;
    this.timeline.push(event);
    void this.eventSink.publish({ type: "streamTimelineToolGroup", event });
  }

  getTimeline(): AssistantTimelineEvent[] {
    return this.timeline.map((event) =>
      event.type === "tool-group" ? { ...event, toolCallIds: [...event.toolCallIds] } : { ...event },
    );
  }

  done(payload: StreamDonePayload = {}): void {
    void this.eventSink.publish({
      type: "streamDone",
      ...payload,
    });
  }

  error(error: string): void {
    void this.eventSink.publish({
      type: "streamError",
      error,
    });
  }

  fromChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "content":
        this.chunk(chunk.content ?? "");
        break;
      case "reasoning":
        this.reasoning(chunk.reasoning_content ?? "");
        break;
      case "done":
        this.done({
          finish_reason: chunk.finish_reason,
        });
        break;
      case "error":
        this.error(chunk.error ?? "Unknown stream error");
        break;
      case "tool_call":
        break;
      case "usage":
        break;
    }
  }

  private text(eventType: "reasoning" | "content", content: string): void {
    if (!content) {
      return;
    }

    if (!this.activeTextEvent || this.activeTextEvent.type !== eventType) {
      const event: Extract<AssistantTimelineEvent, { type: "reasoning" | "content" }> =
        eventType === "reasoning"
          ? { id: randomUUID(), type: "reasoning", content: "" }
          : { id: randomUUID(), type: "content", content: "" };
      this.activeTextEvent = event;
      this.timeline.push(event);
    }

    const activeTextEvent = this.activeTextEvent;
    activeTextEvent.content = eventType === "reasoning"
      ? appendBoundedUtf8(activeTextEvent.content, content, MAX_RETAINED_REASONING_BYTES)
      : activeTextEvent.content + content;
    void this.eventSink.publish({
      type: "streamTimelineDelta",
      eventId: activeTextEvent.id,
      eventType,
      content,
    });
  }
}

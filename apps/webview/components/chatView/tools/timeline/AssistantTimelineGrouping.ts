import type { AssistantTimelineEvent } from "@/contracts";
import type { ToolCallGroup, ToolCallStatus } from "@webview/views/chatView/ChatViewTypes";

type ActivityEvent = AssistantTimelineEvent;

export interface AssistantActivityRound {
  id: string;
  round: number;
  events: ActivityEvent[];
}

export type AssistantTimelineBlock =
  | Extract<AssistantTimelineEvent, { type: "content" }>
  | {
      id: string;
      type: "activity";
      rounds: AssistantActivityRound[];
    };

export interface ActivitySummary {
  status: ToolCallStatus;
}

export function groupAssistantTimeline(
  timeline: AssistantTimelineEvent[],
  options: { compactCompletedCycle?: boolean } = {},
): AssistantTimelineBlock[] {
  if (options.compactCompletedCycle) {
    return groupCompletedCycle(timeline);
  }

  const blocks: AssistantTimelineBlock[] = [];
  let activityEvents: ActivityEvent[] = [];

  const flushActivity = () => {
    if (activityEvents.length === 0) {
      return;
    }
    blocks.push({
      id: `activity-${activityEvents[0]!.id}`,
      type: "activity",
      rounds: groupActivityRounds(activityEvents),
    });
    activityEvents = [];
  };

  for (const event of timeline) {
    if (event.type === "content") {
      flushActivity();
      if (event.content) {
        blocks.push(event);
      }
    } else if (event.type === "tool-group" || event.content) {
      activityEvents.push(event);
    }
  }
  flushActivity();
  return blocks;
}

function groupCompletedCycle(timeline: AssistantTimelineEvent[]): AssistantTimelineBlock[] {
  const visibleEvents = timeline.filter((event) => event.type === "tool-group" || Boolean(event.content));
  let lastActivityIndex = -1;
  for (let index = visibleEvents.length - 1; index >= 0; index -= 1) {
    if (visibleEvents[index].type !== "content") {
      lastActivityIndex = index;
      break;
    }
  }

  if (lastActivityIndex < 0) {
    return visibleEvents.filter((event): event is Extract<AssistantTimelineEvent, { type: "content" }> => event.type === "content");
  }

  const activityEvents = visibleEvents.slice(0, lastActivityIndex + 1);
  let finalContent = visibleEvents
    .slice(lastActivityIndex + 1)
    .filter((event): event is Extract<AssistantTimelineEvent, { type: "content" }> => event.type === "content");

  if (finalContent.length === 1) {
    const split = splitFinalPreamble(finalContent[0]);
    if (split.activity) {
      activityEvents.push(split.activity);
    }
    finalContent = [split.final];
  }

  return [{
    id: `activity-${activityEvents[0]!.id}`,
    type: "activity",
    rounds: groupActivityRounds(activityEvents),
  }, ...finalContent];
}

function groupActivityRounds(events: ActivityEvent[]): AssistantActivityRound[] {
  const rounds: AssistantActivityRound[] = [];
  let pending: ActivityEvent[] = [];
  let nextRound = 1;

  const flush = (round: number) => {
    if (pending.length === 0) {return;}
    rounds.push({
      id: `activity-round-${round}-${pending[0]!.id}`,
      round,
      events: pending,
    });
    pending = [];
    nextRound = round + 1;
  };

  for (const event of events) {
    pending.push(event);
    if (event.type === "tool-group") {
      flush(event.round);
    }
  }
  flush(nextRound);
  return rounds;
}

function splitFinalPreamble(
  event: Extract<AssistantTimelineEvent, { type: "content" }>,
): {
  activity?: Extract<AssistantTimelineEvent, { type: "content" }>;
  final: Extract<AssistantTimelineEvent, { type: "content" }>;
} {
  const separator = /\n{2,}(?=#{1,6}[ \t]+\S)/.exec(event.content);
  if (!separator || separator.index <= 0) {
    return { final: event };
  }

  const preamble = event.content.slice(0, separator.index).trim();
  if (!isProcessPreamble(preamble)) {
    return { final: event };
  }

  return {
    activity: { id: `${event.id}-activity`, type: "content", content: preamble },
    final: {
      ...event,
      content: event.content.slice(separator.index + separator[0].length).trimStart(),
    },
  };
}

function isProcessPreamble(content: string): boolean {
  const ending = content.slice(-500);
  return /(?:\bI (?:now )?have (?:everything|enough|all (?:the )?(?:context|information))|\b(?:Now I|I can now) (?:summarize|provide|present|answer)|\bLet me (?:summarize|provide|present)|\b(?:ya tengo|tengo ya) (?:todo|suficiente|toda la informaci[oó]n)|\b(?:ahora puedo|ya puedo) (?:resumir|presentar|responder)|\b(?:d[eé]jame|voy a) (?:resumir|presentar))(?:[^.!?]*)[.!?]?\s*$/i.test(ending);
}

export function summarizeActivity(
  events: ActivityEvent[],
  toolCallGroups: ToolCallGroup[],
  missingToolStatus: ToolCallStatus = "pending",
): ActivitySummary {
  const statuses: ToolCallStatus[] = [];

  for (const event of events) {
    if (event.type === "content") {
      continue;
    }
    if (event.type === "reasoning") {
      continue;
    }
    const group = toolCallGroups.find((candidate) => candidate.round === event.round);
    const calls = new Map(group?.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
    for (const toolCallId of event.toolCallIds) {
      statuses.push(calls.get(toolCallId)?.status ?? missingToolStatus);
    }
  }

  const activeStatus = statuses.find((status) => status === "awaiting_confirmation") ??
    statuses.find((status) => status === "running") ??
    statuses.find((status) => status === "pending");
  return {
    status: activeStatus ?? statuses.at(-1) ?? "completed",
  };
}

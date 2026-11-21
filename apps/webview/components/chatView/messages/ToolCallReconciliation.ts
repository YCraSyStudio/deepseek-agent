import type { ChatMessage, ToolCallGroup } from "@webview/views/chatView/ChatViewTypes";

export function buildMessageToolCallGroups(message: ChatMessage): ToolCallGroup[] {
  if (!message.toolCalls?.length) {
    return [];
  }
  const grouped = new Map<number, ToolCallGroup>();
  message.toolCalls.forEach((toolCall) => {
    if (!toolCall.round || toolCall.round <= 0 || !toolCall.toolCallId) {
      return;
    }
    const round = toolCall.round;
    if (!grouped.has(round)) {
      grouped.set(round, {
        id: `tool-message-${message.id}-round-${round}`,
        round,
        expanded: false,
        toolCalls: [],
      });
    }
    grouped.get(round)!.toolCalls.push({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      status: toolCall.status,
      result: toolCall.result,
      round,
      requiresConfirmation: toolCall.requiresConfirmation ?? false,
      dangerLevel: toolCall.dangerLevel,
      dangerConfirmed: toolCall.dangerConfirmed,
      dangerConfirmation: toolCall.dangerConfirmation,
    });
  });
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group);
}

export function mergeToolCallGroups(
  storedGroups: ToolCallGroup[],
  activeGroups: ToolCallGroup[],
): ToolCallGroup[] {
  const groups = new Map(storedGroups.map((group) => [group.round, group]));
  for (const activeGroup of activeGroups) {
    const storedGroup = groups.get(activeGroup.round);
    if (!storedGroup) {
      groups.set(activeGroup.round, activeGroup);
      continue;
    }
    const calls = new Map(
      storedGroup.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]),
    );
    for (const toolCall of activeGroup.toolCalls) {
      calls.set(toolCall.toolCallId, toolCall);
    }
    groups.set(activeGroup.round, { ...storedGroup, toolCalls: [...calls.values()] });
  }
  return [...groups.values()].sort((a, b) => a.round - b.round);
}

export function reconcileLatestAssistantToolCalls(
  messages: ChatMessage[],
  liveGroups: ToolCallGroup[],
): ChatMessage[] {
  let messageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      messageIndex = index;
      break;
    }
  }
  if (messageIndex < 0) {return messages;}

  const message = messages[messageIndex];
  const timelineToolCallIds = (message.timeline ?? []).flatMap((event) =>
    event.type === "tool-group" ? event.toolCallIds : [],
  );
  if (timelineToolCallIds.length === 0) {return messages;}

  const allowedIds = new Set(timelineToolCallIds);
  const calls = new Map(message.toolCalls?.map((toolCall) => [toolCall.toolCallId, toolCall]));
  for (const group of liveGroups) {
    for (const toolCall of group.toolCalls) {
      if (!allowedIds.has(toolCall.toolCallId)) {continue;}
      calls.set(toolCall.toolCallId, {
        ...calls.get(toolCall.toolCallId),
        ...toolCall,
        round: group.round,
      });
    }
  }

  const nextToolCalls = timelineToolCallIds.flatMap((toolCallId) => {
    const toolCall = calls.get(toolCallId);
    return toolCall ? [toolCall] : [];
  });
  if (JSON.stringify(nextToolCalls) === JSON.stringify(message.toolCalls ?? [])) {return messages;}

  const nextMessages = [...messages];
  nextMessages[messageIndex] = { ...message, toolCalls: nextToolCalls };
  return nextMessages;
}

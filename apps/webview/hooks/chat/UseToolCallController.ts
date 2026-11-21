import { useCallback, useMemo, useRef, useState } from "react";
import type { GenerationSnapshot, StoredToolCall, ToolCall } from "@/contracts";
import type { VsCodeApi } from "@webview/VsCodeApi";
import type { ChatMessage, ToolCallAction, ToolCallGroup, ToolCallState } from "../../views/chatView/ChatViewTypes";
import type { MessageDispatcher } from "../../views/chatView/hooks";

interface ToolCallControllerOptions {
  conversationId?: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  vscode: VsCodeApi | null;
  actionsDisabled?: boolean;
}

export function useToolCallController({ conversationId, messages, isProcessing, vscode, actionsDisabled = false }: ToolCallControllerOptions) {
  const [toolCallGroups, setToolCallGroups] = useState<ToolCallGroup[]>([]);
  const generationIdRef = useRef<string | undefined>(undefined);

  const dispatcher: MessageDispatcher = {
    onToolCallStarted: useCallback((data) => {
      generationIdRef.current = data.generationId;
      const newGroup = createToolCallGroup({
        toolCalls: data.toolCalls,
        round: data.round,
        status: "running",
      });
      setToolCallGroups((previous) => upsertToolCallGroup(previous, newGroup));
    }, []),

    onToolCallConfirmationRequired: useCallback((data) => {
      generationIdRef.current = data.generationId;
      const newGroup = createToolCallGroup({
        toolCalls: data.toolCalls,
        round: data.round,
        status: "awaiting_confirmation",
        requiresConfirmation: !data.autoExecute,
        dangerConfirmation: data.dangerConfirmation,
      });
      setToolCallGroups((previous) => mergeConfirmationGroup(previous, newGroup));
    }, []),

    onToolCallResult: useCallback((data) => {
      generationIdRef.current = data.generationId ?? generationIdRef.current;
      setToolCallGroups((previous) =>
        previous.map((group) => ({
          ...group,
          toolCalls: group.toolCalls.map((toolCall) =>
            toolCall.toolCallId === data.toolCallId
              ? {
                  ...toolCall,
                  status: data.status,
                  result: data.result,
                  requiresConfirmation: false,
                  dangerConfirmation: undefined,
                  rejected: data.rejected,
                }
              : toolCall,
          ),
        })),
      );
    }, []),

    onToolCallActionAccepted: useCallback((data) => {
      setToolCallGroups((previous) => markToolCallAccepted(previous, data.toolCallId, data.status));
    }, []),

    onGenerationSnapshot: useCallback((message) => {
      const generation = message.generations.find((candidate) => candidate.conversationId === conversationId);
      if (!generation) {
        return;
      }
      generationIdRef.current = generation.generationId;
      if (generation.toolCalls.length > 0) {
        setToolCallGroups(createSnapshotToolCallGroups(generation));
      }
    }, [conversationId]),

    onStreamDone: useCallback((info) => {
      if (info.status !== "completed") {
        setToolCallGroups([]);
      }
    }, []),

    onClearChat: useCallback(() => {
      setToolCallGroups([]);
    }, []),
  };

  const activeTimelineGroups = useMemo(() => getVisibleActiveGroups(messages, toolCallGroups), [messages, toolCallGroups]);

  const timelineMetrics = useMemo(
    () =>
      activeTimelineGroups.reduce(
        (sum, group) => sum + group.toolCalls.filter((toolCall) => toolCall.status === "completed" || toolCall.status === "error").length,
        0,
      ),
    [activeTimelineGroups],
  );
  const pendingToolCalls = useMemo(() => getPendingUserDecisionToolCalls(activeTimelineGroups), [activeTimelineGroups]);

  const postToolCallAction = useCallback(
    (toolCallId: string, action: ToolCallAction) => {
      const generationId = generationIdRef.current;
      if (generationId && !actionsDisabled) {
        vscode?.postMessage({ type: "executeToolCall", generationId, toolCallId, action });
      }
    },
    [actionsDisabled, vscode],
  );

  const handleExecute = useCallback(
    (toolCallId: string) => postToolCallAction(toolCallId, "execute"),
    [postToolCallAction],
  );
  const handleReject = useCallback((toolCallId: string) => postToolCallAction(toolCallId, "reject"), [postToolCallAction]);
  const handleExecuteAll = useCallback(() => {
    getPendingToolCalls(toolCallGroups).forEach((toolCall) => postToolCallAction(toolCall.toolCallId, "execute"));
  }, [postToolCallAction, toolCallGroups]);
  const handleRejectAll = useCallback(() => {
    getPendingToolCalls(toolCallGroups).forEach((toolCall) => postToolCallAction(toolCall.toolCallId, "reject"));
  }, [postToolCallAction, toolCallGroups]);
  return {
    dispatcher,
    toolCallGroups,
    activeTimelineGroups,
    pendingToolCalls,
    currentRound: toolCallGroups.length > 0 ? toolCallGroups.length : undefined,
    timelineMetrics,
    handleExecute,
    handleReject,
    handleExecuteAll,
    handleRejectAll,
    isProcessing,
  };
}

export function createSnapshotToolCallGroups(
  generation: Pick<GenerationSnapshot, "toolCalls">,
): ToolCallGroup[] {
  const groups = new Map<number, StoredToolCall[]>();
  for (const toolCall of generation.toolCalls) {
    const round = toolCall.round ?? 1;
    const existing = groups.get(round);
    if (existing) {
      existing.push(toolCall);
    } else {
      groups.set(round, [toolCall]);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, toolCalls]) => ({
      id: `tool-round-${round}`,
      round,
      expanded: true,
      toolCalls: toolCalls.map((toolCall) => ({
        ...toolCall,
        round,
      })),
    }));
}

interface CreateToolCallGroupOptions {
  toolCalls: ToolCall[];
  round: number;
  status: "running" | "awaiting_confirmation";
  requiresConfirmation?: boolean;
  dangerConfirmation?: Parameters<NonNullable<MessageDispatcher["onToolCallConfirmationRequired"]>>[0]["dangerConfirmation"];
}

function createToolCallGroup(options: CreateToolCallGroupOptions): ToolCallGroup {
  const { toolCalls, round, status, requiresConfirmation = false, dangerConfirmation } = options;

  return {
    id: `tool-round-${round}`,
    round,
    expanded: true,
    toolCalls: toolCalls.map((toolCall) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      arguments: toolCall.function.arguments,
      status,
      round,
      requiresConfirmation,
      ...(dangerConfirmation ? { dangerConfirmation } : {}),
    })),
  };
}

function upsertToolCallGroup(groups: ToolCallGroup[], newGroup: ToolCallGroup): ToolCallGroup[] {
  const existingIndex = groups.findIndex((group) => group.round === newGroup.round);
  if (existingIndex < 0) {return [...groups, newGroup];}

  const updated = [...groups];
  updated[existingIndex] = newGroup;
  return updated;
}

function mergeConfirmationGroup(groups: ToolCallGroup[], newGroup: ToolCallGroup): ToolCallGroup[] {
  const existingIndex = groups.findIndex((group) => group.round === newGroup.round);
  if (existingIndex < 0) {return [...groups, newGroup];}

  const updated = [...groups];
  const existingGroup = updated[existingIndex];
  updated[existingIndex] = {
    ...existingGroup,
    toolCalls: existingGroup.toolCalls.map((existingToolCall) => {
      const nextToolCall = newGroup.toolCalls.find((toolCall) => toolCall.toolCallId === existingToolCall.toolCallId);
      return nextToolCall ? { ...existingToolCall, ...nextToolCall } : existingToolCall;
    }),
  };
  return updated;
}

export function getVisibleActiveGroups(messages: ChatMessage[], activeGroups: ToolCallGroup[]): ToolCallGroup[] {
  const terminalStoredToolCallIds = new Set(messages.flatMap((message) =>
    message.toolCalls
      ?.filter((toolCall) =>
        toolCall.status === "completed" ||
        toolCall.status === "error" ||
        toolCall.status === "rejected" ||
        toolCall.status === "cancelled"
      )
      .map((toolCall) => toolCall.toolCallId) ?? []
  ));

  return activeGroups
    .map((group) => ({
      ...group,
      toolCalls: group.toolCalls.filter((toolCall) => !terminalStoredToolCallIds.has(toolCall.toolCallId)),
    }))
    .filter((group) => group.toolCalls.length > 0);
}

function getPendingToolCalls(groups: ToolCallGroup[]) {
  return groups
    .flatMap((group) => group.toolCalls)
    .filter((toolCall) => toolCall.requiresConfirmation && toolCall.status === "awaiting_confirmation" && !toolCall.dangerConfirmation);
}

function getPendingUserDecisionToolCalls(groups: ToolCallGroup[]): ToolCallState[] {
  return groups
    .flatMap((group) => group.toolCalls)
    .filter((toolCall) => toolCall.status === "awaiting_confirmation" && (toolCall.requiresConfirmation || toolCall.dangerConfirmation));
}

function markToolCallAccepted(groups: ToolCallGroup[], toolCallId: string, status: "running" | "rejected"): ToolCallGroup[] {
  return groups.map((group) => ({
    ...group,
    toolCalls: group.toolCalls.map((toolCall) =>
      toolCall.toolCallId === toolCallId
        ? {
            ...toolCall,
            status,
            requiresConfirmation: false,
            dangerConfirmation: undefined,
            rejected: status === "rejected",
          }
        : toolCall,
    ),
  }));
}

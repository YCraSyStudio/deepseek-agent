import { useCallback, useRef, useState } from "react";
import type { AppConfig, ContextWindowStatus, HandlerToWebviewMessage } from "@/contracts";
import type { ConversationUsageSnapshot } from "@/shared/usage/Usage";
import type { ChatMessage, InitialConfig, StoredToolCall } from "../../views/chatView/ChatViewTypes";
import { reasoningFromConfig, useStreamHandler, type MessageDispatcher } from "../../views/chatView/hooks";

interface ChatMessagesControllerOptions {
  externalMessages?: ChatMessage[];
  externalSetMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  externalIsProcessing?: boolean;
  externalListRef?: React.RefObject<HTMLDivElement | null>;
  conversationId?: string;
  onApiKeyStatusChange?: (status: "configured" | "missing") => void;
  onConfigLoaded?: (config: InitialConfig) => void;
  onConfigUpdateResult?: (message: Extract<HandlerToWebviewMessage, { type: "configUpdateResult" }>) => void;
  onModelChanged?: (modelId: string) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onConversationUsageUpdated?: (usage: ConversationUsageSnapshot) => void;
  onContextWindowUpdated?: (contextWindow: ContextWindowStatus) => void;
  onContextCompactionResult?: (result: { requestId: string; status: "compacted" | "empty" | "failed"; freedTokens?: number; error?: string }) => void;
  focusInput: () => void;
}

export function useChatMessagesController({
  externalMessages,
  externalSetMessages,
  externalIsProcessing,
  externalListRef,
  conversationId,
  onApiKeyStatusChange,
  onConfigLoaded,
  onConfigUpdateResult,
  onModelChanged,
  onProcessingChange,
  onConversationUsageUpdated,
  onContextWindowUpdated,
  onContextCompactionResult,
  focusInput,
}: ChatMessagesControllerOptions) {
  const [internalMessages, setInternalMessages] = useState<ChatMessage[]>([]);
  const [internalIsProcessing, setInternalIsProcessing] = useState(false);
  const internalListRef = useRef<HTMLDivElement | null>(null);
  const activeGenerationIdRef = useRef<string | undefined>(undefined);
  const { nextMessageId, streamingMessageIdRef, appendTimelineDelta, appendTimelineToolGroup, flushTimelineDeltas, resetStreaming } = useStreamHandler();

  const messages = externalMessages ?? internalMessages;
  const setMessages = externalSetMessages ?? setInternalMessages;
  const isProcessing = externalIsProcessing ?? internalIsProcessing;
  const listRef = externalListRef ?? internalListRef;

  const setProcessing = useCallback(
    (value: boolean) => {
      setInternalIsProcessing(value);
      onProcessingChange?.(value);
    },
    [onProcessingChange],
  );

  const dispatcher: MessageDispatcher = {
    onContextCompacted: useCallback(() => {
      setMessages((current) => [...current, { id: nextMessageId(), role: "context", content: "" }]);
    }, [nextMessageId, setMessages]),

    onResourceLimitReached: useCallback(({ error }) => {
      setMessages((current) => [...current, { id: nextMessageId(), role: "error", content: error }]);
    }, [nextMessageId, setMessages]),

    onAddMessage: useCallback(
      (message) => {
        flushTimelineDeltas();
        const { wasStreamed, ...rest } = message;
        setMessages((current) => {
          if (wasStreamed && rest.role === "assistant") {
            if (!streamingMessageIdRef.current) {
              return [...current, {
                id: nextMessageId(),
                role: "assistant",
                content: rest.content,
                toolCalls: rest.toolCalls as StoredToolCall[] | undefined,
                timeline: rest.timeline,
                usage: rest.usage,
                generationId: rest.generationId,
              }];
            }
            return updateStreamedAssistant(current, streamingMessageIdRef.current, rest.toolCalls, rest.timeline);
          }

          return [
            ...current,
            {
              id: nextMessageId(),
              role: rest.role as ChatMessage["role"],
              content: rest.content,
              toolCalls: rest.toolCalls as StoredToolCall[] | undefined,
              timeline: rest.timeline,
              usage: rest.usage,
              imageAttachments: rest.imageAttachments,
              generationId: rest.generationId,
            },
          ];
        });
      },
      [nextMessageId, setMessages, streamingMessageIdRef, flushTimelineDeltas],
    ),

    onShowTyping: useCallback((generationId?: string) => {
      activeGenerationIdRef.current = generationId;
      setProcessing(true);
      resetStreaming();
    }, [setProcessing, resetStreaming]),

    onStreamTimelineDelta: useCallback(
      ({ generationId, eventId, eventType, content }) => {
        if (activeGenerationIdRef.current && generationId && generationId !== activeGenerationIdRef.current) {
          return;
        }
        appendTimelineDelta(eventId, eventType, content, setMessages, generationId);
      },
      [appendTimelineDelta, setMessages],
    ),

    onStreamTimelineToolGroup: useCallback(
      (event, generationId) => {
        if (activeGenerationIdRef.current && generationId && generationId !== activeGenerationIdRef.current) {
          return;
        }
        appendTimelineToolGroup(event, setMessages, generationId);
      },
      [appendTimelineToolGroup, setMessages],
    ),

    onStreamDone: useCallback(
      (info) => {
        if (activeGenerationIdRef.current && info.generationId && info.generationId !== activeGenerationIdRef.current) {
          return;
        }
        activeGenerationIdRef.current = undefined;
        flushTimelineDeltas();
        setProcessing(false);

        if (info.generationId) {
          setMessages((current) => markGenerationTerminal(
            current,
            info.generationId!,
            info.status,
            info.generationStopReason,
            nextMessageId,
          ));
        }
        resetStreaming();

        const incompleteMessage = getIncompleteFinishMessage(info.finish_reason);
        if (incompleteMessage) {
          setMessages((current) => [...current, { id: nextMessageId(), role: "error", content: incompleteMessage }]);
        }

        focusInput();
      },
      [focusInput, setMessages, setProcessing, resetStreaming, flushTimelineDeltas, nextMessageId],
    ),

    onStreamError: useCallback(
      (error: string, generationId?: string) => {
        if (activeGenerationIdRef.current && generationId && generationId !== activeGenerationIdRef.current) {
          return;
        }
        activeGenerationIdRef.current = undefined;
        setProcessing(false);
        resetStreaming();
        setMessages((current) => [...current, { id: nextMessageId(), role: "error", content: error }]);
        focusInput();
      },
      [focusInput, setProcessing, resetStreaming, nextMessageId, setMessages],
    ),

    onClearChat: useCallback(() => {
      setMessages([]);
      setProcessing(false);
      resetStreaming();
    }, [setMessages, setProcessing, resetStreaming]),

    onModelChanged: useCallback((modelId: string) => onModelChanged?.(modelId), [onModelChanged]),
    onApiKeyStatus: useCallback((status) => onApiKeyStatusChange?.(status), [onApiKeyStatusChange]),
    onConfigLoaded: useCallback(
      (config: Partial<AppConfig>, revision: number) => {
        onConfigLoaded?.({
          revision,
          reasoning: reasoningFromConfig(config),
          model: config.model ?? undefined,
          permissionMode: config.permissionMode,
          historyEnabled: config.historyEnabled,
          usageBreakdown: config.usageBreakdown,
          usageCostCurrency: config.usageCostCurrency,
        });
      },
      [onConfigLoaded],
    ),
    onAssistantUsageUpdated: useCallback(
      (data) => {
        setMessages((current) => {
          const targetIndex = findAssistantIndex(current, data.generationId);
          if (targetIndex < 0) {
            return current;
          }
          return current.map((message, index) => (index === targetIndex ? { ...message, usage: data.usage } : message));
        });
      },
      [setMessages],
    ),

    onConfigUpdateResult: useCallback((message) => onConfigUpdateResult?.(message), [onConfigUpdateResult]),

    onConversationUsageUpdated: useCallback(
      (data) => {
        if (conversationId !== undefined && data.conversationId !== conversationId) {
          return;
        }
        onConversationUsageUpdated?.(data.usage);
      },
      [conversationId, onConversationUsageUpdated],
    ),

    onContextWindowUpdated: useCallback(
      (data) => {
        if (conversationId !== undefined && data.conversationId !== conversationId) {
          return;
        }
        onContextWindowUpdated?.(data.contextWindow);
      },
      [conversationId, onContextWindowUpdated],
    ),

    onContextCompactionResult: useCallback(
      (result) => onContextCompactionResult?.(result),
      [onContextCompactionResult],
    ),
  };

  return { messages, isProcessing, listRef, dispatcher };
}

function markGenerationTerminal(
  messages: ChatMessage[],
  generationId: string,
  status: "completed" | "cancelled" | "interrupted",
  generationStopReason: ChatMessage["generationStopReason"],
  nextMessageId: () => string,
): ChatMessage[] {
  let assistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].generationId === generationId) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) {
    return status === "completed"
      ? messages
      : [...messages, { id: nextMessageId(), role: "assistant", content: "", generationId, generationStatus: status, generationStopReason }];
  }
  return messages.map((message, index) => index === assistantIndex
    ? { ...message, generationStatus: status, generationStopReason }
    : message);
}

function findAssistantIndex(messages: ChatMessage[], generationId: string | undefined): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && (generationId === undefined || message.generationId === generationId)) {
      return index;
    }
  }
  return -1;
}

function getIncompleteFinishMessage(finishReason: string | undefined): string | undefined {
  if (finishReason === "length") {return "DeepSeek reached the output limit. The visible response is incomplete.";}
  if (finishReason === "content_filter") {return "DeepSeek stopped because content was filtered. The visible response is incomplete.";}
  if (finishReason === "insufficient_system_resource") {return "DeepSeek stopped because provider resources were insufficient. You can retry the request.";}
  if (finishReason && finishReason !== "stop" && finishReason !== "tool_calls") {
    return `DeepSeek stopped with finish reason "${finishReason}". The visible response may be incomplete.`;
  }
  return undefined;
}

function updateStreamedAssistant(
  current: ChatMessage[],
  streamingId: string | null,
  toolCalls: StoredToolCall[] | undefined,
  timeline: ChatMessage["timeline"],
): ChatMessage[] {
  const patch = (message: ChatMessage): ChatMessage => ({
    ...message,
    toolCalls: toolCalls as StoredToolCall[] | undefined,
    timeline: timeline ?? message.timeline,
  });

  if (streamingId) {
    const index = current.findIndex((message) => message.id === streamingId);
    if (index >= 0) {
      return current.map((message, messageIndex) => (messageIndex === index ? patch(message) : message));
    }
  }

  return current;
}

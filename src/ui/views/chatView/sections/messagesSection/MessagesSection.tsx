import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./MessagesSection.css";
import { useVsCode } from "../../contexts";
import type { MessagesSectionProps, ToolCallGroup } from "../../ChatViewTypes";
import { useMessageHandler } from "../../hooks";
import { ChatEmptyState, ChatMessages, ToolCallConfirmationModal, ToolCallTimeline } from "@webview/components/chatView";
import { useChatMessagesController, useCodeActionHandler, useToolCallController } from "../../../../hooks/chat";
import { t } from "@webview/i18n";
import { beginNavigationRequest } from "@webview/NavigationRequests";
import { reconcileLatestAssistantToolCalls } from "@webview/components/chatView/messages/ToolCallReconciliation";
import {
  followChatWindowGrowth,
  growChatWindow,
  hiddenChatMessageCount,
  initialChatWindowSize,
  visibleChatMessages,
} from "@webview/components/chatView/messages/ChatMessageWindow";

function MessagesSection({
  getGenerationScope,
  conversationId,
  activeGenerationId,
  messages: externalMessages,
  onMessagesChange,
  isProcessing: externalIsProcessing,
  listRef: externalListRef,
  onApiKeyStatusChange,
  onConfigLoaded,
  onConfigUpdateResult,
  permissionUpdatePending = false,
  onModelChanged,
  onProcessingChange,
  onConversationUsageUpdated,
  onContextWindowUpdated,
  onContextCompactionResult,
  onFocusInput,
  earlierMessagesLoaded = 0,
  historyCursor,
}: MessagesSectionProps) {
  const vscode = useVsCode();
  const focusInput = useCallback(() => onFocusInput?.(), [onFocusInput]);
  const handleCodeAction = useCodeActionHandler(vscode);
  const renderToolCallGroups = useCallback(
    (groups: ToolCallGroup[]) => (
      <ToolCallTimeline groups={groups} vscode={vscode} conversationId={conversationId} />
    ),
    [vscode, conversationId],
  );

  const chat = useChatMessagesController({
    externalMessages,
    externalSetMessages: onMessagesChange,
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
  });

  const tools = useToolCallController({
    conversationId,
    messages: chat.messages,
    isProcessing: chat.isProcessing,
    vscode,
    actionsDisabled: permissionUpdatePending,
  });
  const { dispatcher: chatDispatcher, isProcessing, listRef, messages } = chat;
  const dispatcher = mergeMessageDispatchers(chatDispatcher, tools.dispatcher);
  const followsLatestRef = useRef(true);
  const scrollAnchorRef = useRef<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(
    () => initialChatWindowSize(messages.length, earlierMessagesLoaded),
  );
  const hiddenMessageCount = hiddenChatMessageCount(messages.length, visibleMessageCount);
  useEffect(() => {
    setVisibleMessageCount((count) => followChatWindowGrowth(count, messages.length, earlierMessagesLoaded));
  }, [messages.length, earlierMessagesLoaded]);
  const canLoadEarlierHistoryPage = Boolean(conversationId && historyCursor);
  const visibleMessages = useMemo(
    () => visibleChatMessages(messages, visibleMessageCount),
    [messages, visibleMessageCount],
  );
  const timelineToolCallSignature = useMemo(
    () => [...messages]
      .reverse()
      .find((message) => message.role === "assistant")
      ?.timeline?.flatMap((event) => event.type === "tool-group" ? event.toolCallIds : [])
      .join("\u0000") ?? "",
    [messages],
  );

  useEffect(() => {
    if (!onMessagesChange || tools.toolCallGroups.length === 0) {return;}
    onMessagesChange((current) => reconcileLatestAssistantToolCalls(current, tools.toolCallGroups));
  }, [onMessagesChange, timelineToolCallSignature, tools.toolCallGroups]);

  useMessageHandler(vscode, {
    ...dispatcher,
    onContextCompactionUpdated: ({ status }) => setIsCompacting(status === "compacting"),
    onGenerationRecoveryStarted: () => setIsRecovering(true),
    onGenerationSnapshot: (message) => {
      setIsCompacting(message.generations.some(
        (generation) => generation.conversationId === conversationId && generation.status === "compacting",
      ));
      dispatcher.onGenerationSnapshot?.(message);
    },
    onStreamDone: (info) => {
      setIsCompacting(false);
      setIsRecovering(false);
      dispatcher.onStreamDone?.(info);
    },
    onStreamError: (error, generationId) => {
      setIsCompacting(false);
      setIsRecovering(false);
      dispatcher.onStreamError?.(error, generationId);
    },
  }, getGenerationScope ?? { conversationId, activeGenerationId });

  useEffect(() => {
    if (!followsLatestRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  }, [messages, isProcessing, tools.activeTimelineGroups, listRef]);

  const showEarlierMessages = useCallback(() => {
    scrollAnchorRef.current = listRef.current?.scrollHeight ?? null;
    setVisibleMessageCount((count) => growChatWindow(count, messages.length));
  }, [listRef, messages.length]);

  const loadEarlierHistoryPage = useCallback(() => {
    if (!conversationId || !historyCursor) {
      return;
    }
    vscode?.postMessage({
      type: "loadConversationPage",
      requestId: beginNavigationRequest(),
      id: conversationId,
      cursor: historyCursor,
    });
  }, [conversationId, historyCursor, vscode]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const anchor = scrollAnchorRef.current;
    if (!list || anchor === null) {
      return;
    }
    scrollAnchorRef.current = null;
    const growth = list.scrollHeight - anchor;
    if (growth > 0) {
      list.scrollTop += growth;
    }
  }, [visibleMessageCount, listRef]);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const followsLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 72;
    followsLatestRef.current = followsLatest;
    setShowJumpToLatest(!followsLatest);
  }, [listRef]);

  const jumpToLatest = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    followsLatestRef.current = true;
    setShowJumpToLatest(false);
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [listRef]);

  const emptyStateVisible = messages.length === 0 && !isProcessing;
  return (
    <>
      <div className="messagesSection">
        <div className="msgList" ref={listRef} onClick={handleCodeAction} onScroll={handleScroll} aria-busy={isProcessing}>
          {emptyStateVisible ? (
            <ChatEmptyState />
          ) : (
            <>
              {hiddenMessageCount > 0 ? (
                <button type="button" className="showEarlierMessages" onClick={showEarlierMessages}>
                  {t("chat.showEarlierMessages", { count: hiddenMessageCount })}
                </button>
              ) : canLoadEarlierHistoryPage ? (
                <button type="button" className="showEarlierMessages" onClick={loadEarlierHistoryPage}>
                  {t("chat.loadEarlierMessages")}
                </button>
              ) : null}
              <ChatMessages
                messages={visibleMessages}
                isProcessing={isProcessing}
                activeToolCallGroups={tools.activeTimelineGroups}
                renderToolCallGroups={renderToolCallGroups}
              />
            </>
          )}

          {isProcessing ? (
            <div className="typingIndicator" role="status" aria-live="polite">
              <div className="typingDots">
                <span /> <span /> <span />
              </div>
              <span className="typingLabel">{t(isCompacting
                ? "chat.compactingContext"
                : isRecovering
                  ? "chat.recoveringConcise"
                  : "chat.deepseekIsThinking")}</span>
            </div>
          ) : null}
        </div>
        {showJumpToLatest ? (
          <button className="jumpToLatest" type="button" onClick={jumpToLatest} aria-label={t("chat.jumpToLatest")}>
            <span className="codicon codicon-arrow-down" aria-hidden="true" />
          </button>
        ) : null}
        <span className="streamStatus srOnly" role="status" aria-live="polite">
          {isProcessing ? t("chat.streaming") : t("chat.finished")}
        </span>
      </div>
      <ToolCallConfirmationModal
        pendingToolCalls={tools.pendingToolCalls}
        onExecute={tools.handleExecute}
        onReject={tools.handleReject}
        onExecuteAll={tools.handleExecuteAll}
        onRejectAll={tools.handleRejectAll}
        disabled={permissionUpdatePending}
      />
    </>
  );
}

export default MessagesSection;

function mergeMessageDispatchers(
  chatDispatcher: Parameters<typeof useMessageHandler>[1],
  toolDispatcher: Parameters<typeof useMessageHandler>[1],
): Parameters<typeof useMessageHandler>[1] {
  return {
    ...chatDispatcher,
    ...toolDispatcher,
    onStreamDone: (info) => {
      chatDispatcher.onStreamDone?.(info);
      toolDispatcher.onStreamDone?.(info);
    },
    onClearChat: () => {
      chatDispatcher.onClearChat?.();
      toolDispatcher.onClearChat?.();
    },
  };
}

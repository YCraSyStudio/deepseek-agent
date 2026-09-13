import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./App.css";
import { Header, HistoryTransitionPanel, TooltipLayer, type HistoryTransition } from "@webview/components/shared";
import { ChatView, SettingsView, HistoryView } from "./views";
import { VsCodeProvider } from "./views/chatView/contexts";
import type { ContextWindowStatus, Conversation, HandlerToWebviewMessage } from "@/contracts";
import type { ConversationUsageSnapshot } from "@/shared/usage/Usage";
import { getVsCodeApi } from "./VsCodeApi";
import { getUiLocale, subscribeUiLocale } from "./i18n";
import { beginNavigationRequest, isLatestNavigationRequest, NAVIGATION_STARTED_EVENT } from "./NavigationRequests";

type ViewType = "chat" | "settings" | "history";

function App() {
  useSyncExternalStore(subscribeUiLocale, getUiLocale, getUiLocale);
  const [currentView, setCurrentView] = useState<ViewType>("chat");
  const [loadedConversation, setLoadedConversation] = useState<Conversation | null>(null);
  const loadedConversationIdRef = useRef<string | undefined>(undefined);
  const [conversationUsage, setConversationUsage] = useState<ConversationUsageSnapshot | undefined>();
  const [contextWindow, setContextWindow] = useState<ContextWindowStatus | undefined>();
  const [chatRevision, setChatRevision] = useState(0);
  const [historyEnabled, setHistoryEnabled] = useState<boolean>();
  const [historyUpdatePending, setHistoryUpdatePending] = useState(false);
  const [historyTransition, setHistoryTransition] = useState<HistoryTransition | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [earlierMessagesLoaded, setEarlierMessagesLoaded] = useState(0);
  const pendingHistoryRequestRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadedConversationIdRef.current = loadedConversation?.id;
  }, [loadedConversation]);

  const handleNewConversation = useCallback(() => {
    const vscode = getVsCodeApi();
    setCurrentView("chat");
    setNavigationPending(true);
    vscode?.postMessage({ type: "newConversation", requestId: beginNavigationRequest() });
  }, []);

  const handleCancelWorkspaceMismatch = useCallback(() => {
    setLoadedConversation(null);
    setConversationUsage(undefined);
    setContextWindow(undefined);
    setEarlierMessagesLoaded(0);
    setCurrentView("history");
    setNavigationPending(false);
    setChatRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    const handleNavigationStarted = () => setNavigationPending(true);
    const handleMessage = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (message.type === "conversationLoaded") {
        if (!isLatestNavigationRequest(message.requestId)) {return;}
        setLoadedConversation(message.conversation);
        setConversationUsage(message.usage);
        setContextWindow(message.contextWindow);
        setEarlierMessagesLoaded(0);
        setNavigationPending(false);
        setChatRevision((revision) => revision + 1);
        setCurrentView("chat");
      } else if (message.type === "conversationLoadRejected") {
        if (!isLatestNavigationRequest(message.requestId)) {return;}
        setNavigationPending(false);
      } else if (message.type === "conversationPageLoaded") {
        if (!isLatestNavigationRequest(message.requestId)) {return;}
        setLoadedConversation((current) => current?.id === message.id ? {
          ...current,
          messages: [...message.messages, ...current.messages],
          hasEarlierMessages: message.hasEarlierMessages,
          historyCursor: message.cursor,
        } : current);
        setEarlierMessagesLoaded((count) => count + message.messages.length);
        setNavigationPending(false);
        setChatRevision((revision) => revision + 1);
      } else if (message.type === "conversationDeleted") {
        const deletedId = message.id;
        setLoadedConversation((current) => (current?.id === deletedId ? null : current));
        setConversationUsage((current) => (loadedConversationIdRef.current === deletedId ? undefined : current));
        setContextWindow((current) => (loadedConversationIdRef.current === deletedId ? undefined : current));
      } else if (message.type === "clearChat") {
        setLoadedConversation(null);
        setConversationUsage(undefined);
        setContextWindow(undefined);
        setEarlierMessagesLoaded(0);
        setNavigationPending(false);
        setChatRevision((revision) => revision + 1);
      } else if (message.type === "newConversationReady") {
        if (!isLatestNavigationRequest(message.requestId)) {return;}
        const vscode = getVsCodeApi();
        vscode?.setState({ schemaVersion: 4, mode: "persistent", draft: "", referencedFiles: [] });
        setLoadedConversation(null);
        setConversationUsage(undefined);
        setContextWindow(undefined);
        setEarlierMessagesLoaded(0);
        setNavigationPending(false);
        setChatRevision((revision) => revision + 1);
      } else if (message.type === "historyError" && message.requestId && isLatestNavigationRequest(message.requestId)) {
        setNavigationPending(false);
      } else if (message.type === "configLoaded") {
        if (message.config.historyEnabled !== undefined) {setHistoryEnabled(message.config.historyEnabled);}
      } else if (message.type === "configUpdateResult") {
        if (message.config.historyEnabled !== undefined) {setHistoryEnabled(message.config.historyEnabled);}
        if (message.requestId === pendingHistoryRequestRef.current) {
          pendingHistoryRequestRef.current = undefined;
          setHistoryUpdatePending(false);
          setHistoryTransition(null);
        }
      } else if (message.type === "historyTransitionRequired") {
        const pendingRequestId = pendingHistoryRequestRef.current;
        if (pendingRequestId && pendingRequestId !== message.requestId) {return;}
        pendingHistoryRequestRef.current = message.requestId;
        setHistoryUpdatePending(true);
        setHistoryTransition(message);
      }
    };

    window.addEventListener(NAVIGATION_STARTED_EVENT, handleNavigationStarted);
    window.addEventListener("message", handleMessage);
    getVsCodeApi()?.postMessage({ type: "getConfig" });
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener(NAVIGATION_STARTED_EVENT, handleNavigationStarted);
    };
  }, []);

  const handleIncognitoToggle = useCallback((incognito: boolean) => {
    const vscode = getVsCodeApi();
    if (!vscode || historyEnabled === undefined || historyUpdatePending) {return;}
    const requestId = crypto.randomUUID();
    pendingHistoryRequestRef.current = requestId;
    setHistoryUpdatePending(true);
    vscode.postMessage({ type: "saveConfig", requestId, config: { historyEnabled: !incognito } });
  }, [historyEnabled, historyUpdatePending]);

  return (
    <VsCodeProvider>
      <div className="app">
        <Header
          currentView={currentView}
          ViewChangeHandler={setCurrentView}
          onNewConversation={handleNewConversation}
          incognitoEnabled={historyEnabled === false}
          incognitoUpdatePending={historyEnabled === undefined || historyUpdatePending}
          onIncognitoToggle={handleIncognitoToggle}
        />
        <div className={`viewPane ${currentView === "chat" ? "active" : "hidden"}`} aria-hidden={currentView !== "chat"}>
          <ChatView
            key={chatRevision}
            loadedConversation={loadedConversation}
            conversationUsage={conversationUsage}
            contextWindow={contextWindow}
            navigationPending={navigationPending}
            earlierMessagesLoaded={earlierMessagesLoaded}
            onCancelWorkspaceMismatch={handleCancelWorkspaceMismatch}
          />
        </div>
        {currentView === "settings" ? (
          <div className="viewPane active">
            <SettingsView />
          </div>
        ) : null}
        {currentView === "history" ? (
          <div className="viewPane active">
            <HistoryView />
          </div>
        ) : null}
        <HistoryTransitionPanel
          transition={historyTransition}
          onDecision={(decision) => {
            if (!historyTransition) {return;}
            getVsCodeApi()?.postMessage({
              type: "resolveHistoryTransition",
              requestId: historyTransition.requestId,
              decision,
            });
          }}
        />
      </div>
      <TooltipLayer />
    </VsCodeProvider>
  );
}

export default App;

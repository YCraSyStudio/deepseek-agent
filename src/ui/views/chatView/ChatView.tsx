import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ChatView.css";
import "@vscode/codicons/dist/codicon.css";
import { InputCtrls, InputFooter, MessagesSection } from "./sections";
import { useChatConfig } from "./hooks";
import WorkspaceMismatchModal from "@webview/components/shared/workspaceMismatchModal/WorkspaceMismatchModal";
import type { ApiKeyStatus, ChatMessage, ContextCompactionResult } from "./ChatViewTypes";
import { getVsCodeApi } from "@webview/VsCodeApi";
import type { ContextWindowStatus, Conversation, ImageAttachment, PermissionMode, QueuedGenerationMessage, ReferencedFile, WorkspaceContextStatus } from "@/contracts";
import { t } from "@webview/i18n";
import { summarizeConversationUsage, type ConversationUsageSnapshot, type UsageCurrency } from "@/shared/usage/Usage";
import { useChatCommandMessages, type PendingChatRequest } from "./hooks/UseChatCommandMessages";
import {
  getSavedChatState,
  mergeReferencedFiles,
  referenceIdentity,
  type PersistentChatViewState,
} from "./model/PersistentChatState";

interface IncognitoChatViewState {
  schemaVersion: 3;
  mode: "incognito";
}

interface ChatViewProps {
  loadedConversation?: Conversation | null;
  conversationUsage?: ConversationUsageSnapshot;
  contextWindow?: ContextWindowStatus;
  navigationPending?: boolean;
  earlierMessagesLoaded?: number;
  onCancelWorkspaceMismatch?: () => void;
}

interface WorkspaceMismatch {
  conversationId: string;
  workspaceName: string;
}

function ChatView({ loadedConversation, conversationUsage, contextWindow, navigationPending = false, earlierMessagesLoaded = 0, onCancelWorkspaceMismatch }: ChatViewProps) {
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>("missing");
  const [isProcessing, setIsProcessing] = useState(false);
  const [draft, setDraft] = useState("");
  const [referencedFiles, setReferencedFiles] = useState<ReferencedFile[]>([]);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(loadedConversation?.messages ?? []);
  const [conversationId, setConversationId] = useState<string | undefined>(loadedConversation?.id);
  const [stateHydrated, setStateHydrated] = useState(false);
  const [activeGenerationId, setActiveGenerationId] = useState<string | undefined>();
  const [recoveredDrafts, setRecoveredDrafts] = useState<QueuedGenerationMessage[]>([]);
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContextStatus>();
  const [workspaceMismatch, setWorkspaceMismatch] = useState<WorkspaceMismatch | null>(null);
  const conversationIdRef = useRef(conversationId);
  const activeGenerationIdRef = useRef(activeGenerationId);
  const pendingRequestsRef = useRef(new Map<string, PendingChatRequest>());
  const getGenerationScope = useCallback(() => ({
    conversationId: conversationIdRef.current,
    activeGenerationId: activeGenerationIdRef.current,
  }), []);
  const draftRef = useRef(draft);
  const referencedFilesRef = useRef(referencedFiles);
  const imageAttachmentsRef = useRef(imageAttachments);
  const [requestError, setRequestError] = useState<string>();
  const [hostUsage, setHostUsage] = useState(conversationUsage);
  const [contextWindowStatus, setContextWindowStatus] = useState(contextWindow);
  const [compaction, setCompaction] = useState<{ pending: boolean; result?: ContextCompactionResult }>({ pending: false });
  const compactionRequestRef = useRef<string | undefined>(undefined);
  const initialConfigHandledRef = useRef(false);
  const workspaceRequestIdRef = useRef<string | undefined>(undefined);
  const workspaceMismatchRef = useRef<string | undefined>(undefined);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const usageSummary = useMemo(() => {
    if (hostUsage) {
      return { total: hostUsage.total, byModel: hostUsage.byModel };
    }
    return summarizeConversationUsage(messages);
  }, [hostUsage, messages]);

  const handleContextWindowUpdated = useCallback((next: ContextWindowStatus) => {
    setContextWindowStatus(next);
  }, []);

  const handleContextCompactionResult = useCallback((result: ContextCompactionResult & { requestId: string }) => {
    if (compactionRequestRef.current !== result.requestId) {
      return;
    }
    compactionRequestRef.current = undefined;
    setCompaction({
      pending: false,
      result: { status: result.status, freedTokens: result.freedTokens, error: result.error },
    });
    if (result.status === "compacted") {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "context", content: "" }]);
    }
  }, []);

  const handleCompactContext = useCallback(() => {
    const vscode = getVsCodeApi();
    if (!vscode || compactionRequestRef.current !== undefined) {
      return;
    }
    const requestId = crypto.randomUUID();
    compactionRequestRef.current = requestId;
    setCompaction({ pending: true });
    vscode.postMessage({ type: "compactContext", requestId, conversationId: conversationIdRef.current });
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    activeGenerationIdRef.current = activeGenerationId;
  }, [activeGenerationId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    referencedFilesRef.current = referencedFiles;
  }, [referencedFiles]);

  useEffect(() => {
    imageAttachmentsRef.current = imageAttachments;
  }, [imageAttachments]);

  const {
    selectedModel,
    reasoning,
    permissionMode,
    historyEnabled,
    isPermissionUpdatePending,
    configUpdateError,
    selectedModelRef,
    reasoningRef,
    applySavedConfig,
    applyConfigUpdateResult,
    handleReasoningChange,
    handleModelChange,
    handlePermissionModeChange,
    usageBreakdown,
    usageCostCurrency,
  } = useChatConfig();

  const handleConfigLoaded = useMemo(
    () => (config: { revision: number; reasoning?: string; model?: string; permissionMode?: PermissionMode; historyEnabled?: boolean; usageBreakdown?: boolean; usageCostCurrency?: UsageCurrency }) => {
      applySavedConfig(config, config.revision);
    },
    [applySavedConfig],
  );

  const handleModelChanged = useMemo(
    () => (modelId: string) => {
      applySavedConfig({ model: modelId });
    },
    [applySavedConfig],
  );

  const focusInput = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = (text: string, clientRequestId: string) => {
    pendingRequestsRef.current.set(clientRequestId, {
      text,
      referenceIds: referencedFilesRef.current.map(referenceIdentity),
      imageIds: imageAttachmentsRef.current.map((attachment) => attachment.id),
    });
    setRequestError(undefined);
  };

  const removeFile = useCallback((index: number) => {
    setReferencedFiles((files) => files.filter((_, i) => i !== index));
  }, []);

  const removeImageAttachment = useCallback((attachment: ImageAttachment) => {
    setImageAttachments((items) => items.filter((item) => item.id !== attachment.id));
    getVsCodeApi()?.postMessage({
      type: "deleteImageAttachment",
      requestId: crypto.randomUUID(),
      attachment,
    });
  }, []);

  const appendReferencedFiles = useCallback((files: ReferencedFile[]) => {
    setReferencedFiles((currentFiles) => mergeReferencedFiles(currentFiles, files));
    requestAnimationFrame(focusInput);
  }, []);

  const canSend = useMemo(() => {
    const trimmedDraft = draft.trim();
    const workspaceReady = workspaceContext?.state === "connected" || workspaceContext?.state === "empty";
    return !navigationPending && !isPermissionUpdatePending &&
      (trimmedDraft.length > 0 || imageAttachments.length > 0) &&
      (apiKeyStatus === "configured" || trimmedDraft.startsWith("/")) &&
      (workspaceReady || trimmedDraft.startsWith("/"));
  }, [draft, imageAttachments, apiKeyStatus, isPermissionUpdatePending, navigationPending, workspaceContext]);

  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    const requestId = crypto.randomUUID();
    workspaceRequestIdRef.current = requestId;
    getVsCodeApi()?.postMessage({ type: "getWorkspaceContext", requestId, conversationId });
  }, [conversationId]);

  useEffect(() => {
    if (
      !conversationId ||
      !loadedConversation ||
      loadedConversation.id !== conversationId ||
      (workspaceContext?.state !== "changed" && workspaceContext?.state !== "disconnected")
    ) {
      workspaceMismatchRef.current = undefined;
      setWorkspaceMismatch(null);
      return;
    }
    const mismatch = `${conversationId}:${workspaceContext.binding.revision}`;
    if (workspaceMismatchRef.current === mismatch) {return;}
    workspaceMismatchRef.current = mismatch;
    setWorkspaceMismatch({
      conversationId,
      workspaceName: workspaceContext.binding.name,
    });
  }, [conversationId, workspaceContext, loadedConversation]);

  useEffect(() => {
    if (historyEnabled === undefined) {
      return;
    }
    const vscode = getVsCodeApi();
    if (!initialConfigHandledRef.current) {
      initialConfigHandledRef.current = true;
      if (historyEnabled && !loadedConversation) {
        const savedState = getSavedChatState();
        if (savedState) {
          setDraft(savedState.draft);
          setReferencedFiles(savedState.referencedFiles);
          setImageAttachments(savedState.imageAttachments);
          setConversationId(savedState.conversationId);
        }
      }
    }
    if (!historyEnabled) {
      vscode?.setState<IncognitoChatViewState>({ schemaVersion: 3, mode: "incognito" });
    }
    setStateHydrated(true);
  }, [historyEnabled, loadedConversation]);

  useEffect(() => {
    const vscode = getVsCodeApi();
    if (!stateHydrated || historyEnabled === undefined) {
      return;
    }
    if (!historyEnabled) {
      vscode?.setState<IncognitoChatViewState>({ schemaVersion: 3, mode: "incognito" });
      return;
    }
    vscode?.setState<PersistentChatViewState>({
      schemaVersion: 5,
      mode: "persistent",
      draft,
      referencedFiles: referencedFiles.filter((file) => file.scope !== "external-snapshot"),
      imageAttachments,
      conversationId,
    });
  }, [draft, referencedFiles, imageAttachments, conversationId, historyEnabled, stateHydrated]);

  const handleConfirmWorkspaceMismatch = useCallback(() => {
    if (!workspaceMismatch) {return;}
    workspaceMismatchRef.current = undefined;
    setWorkspaceMismatch(null);
    getVsCodeApi()?.postMessage({
      type: "rebindConversationWorkspace",
      conversationId: workspaceMismatch.conversationId,
      workspaceRevision: workspaceContext?.binding.revision,
    });
  }, [workspaceMismatch, workspaceContext]);

  const handleCancelWorkspaceMismatch = useCallback(() => {
    workspaceMismatchRef.current = undefined;
    setWorkspaceMismatch(null);
    onCancelWorkspaceMismatch?.();
  }, [onCancelWorkspaceMismatch]);

  useChatCommandMessages({
    appendReferencedFiles,
    focusInput,
    refs: {
      activeGenerationId: activeGenerationIdRef,
      conversationId: conversationIdRef,
      draft: draftRef,
      imageAttachments: imageAttachmentsRef,
      pendingRequests: pendingRequestsRef,
      referencedFiles: referencedFilesRef,
      workspaceRequestId: workspaceRequestIdRef,
    },
    setters: {
      setActiveGenerationId,
      setConversationId,
      setDraft,
      setImageAttachments,
      setIsProcessing,
      setMessages,
      setRecoveredDrafts,
      setReferencedFiles,
      setRequestError,
      setWorkspaceContext,
    },
  });

  return (
    <div className="chatView">
      {workspaceMismatch ? (
        <WorkspaceMismatchModal
          workspaceName={workspaceMismatch.workspaceName}
          onConfirm={handleConfirmWorkspaceMismatch}
          onCancel={handleCancelWorkspaceMismatch}
        />
      ) : null}
      <MessagesSection
        getGenerationScope={getGenerationScope}
        conversationId={conversationId}
        historyCursor={loadedConversation?.hasEarlierMessages ? loadedConversation.historyCursor : undefined}
        activeGenerationId={activeGenerationId}
        messages={messages}
        onMessagesChange={setMessages}
        isProcessing={isProcessing}
        onApiKeyStatusChange={setApiKeyStatus}
        onConfigLoaded={handleConfigLoaded}
        onConfigUpdateResult={applyConfigUpdateResult}
        permissionUpdatePending={isPermissionUpdatePending}
        earlierMessagesLoaded={earlierMessagesLoaded}
        onModelChanged={handleModelChanged}
        onProcessingChange={setIsProcessing}
        onConversationUsageUpdated={setHostUsage}
        onContextWindowUpdated={handleContextWindowUpdated}
        onContextCompactionResult={handleContextCompactionResult}
        onFocusInput={focusInput}
      />
      {apiKeyStatus === "missing" ? <div className="statusMessage warning">{t("chat.apiKeyMissing")}</div> : null}
      {isPermissionUpdatePending ? <div className="statusMessage" role="status" aria-live="polite">{t("chat.applyingPermissions")}</div> : null}
      {configUpdateError ? <div className="statusMessage warning" role="alert">{configUpdateError}</div> : null}
      {requestError ? <div className="statusMessage warning" role="alert">{requestError}</div> : null}
      {historyEnabled === false ? <div className="statusMessage incognito" role="status">{t("chat.incognitoActive")}</div> : null}

      <div className="inputArea">
        {recoveredDrafts.length > 0 ? (
          <div className="statusMessage">
            {t("chat.recoveredDrafts")}
            {recoveredDrafts.map((item, index) => (
              <button
                key={`${index}-${item.text.slice(0, 24)}`}
                type="button"
                onClick={() => {
                  setDraft(item.text);
                  if (item.referencedFiles?.length) {
                    setReferencedFiles((current) => mergeReferencedFiles(current, item.referencedFiles!));
                  }
                  setRecoveredDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
                  if (conversationId) {
                    getVsCodeApi()?.postMessage({
                      type: "consumeRecoveredDraft",
                      conversationId,
                      clientRequestId: item.clientRequestId,
                    });
                  }
                }}
              >
                {t("chat.restoreDraft")}: {item.text.slice(0, 48)}
              </button>
            ))}
          </div>
        ) : null}
        <InputCtrls
          ref={textareaRef}
          input={draft}
          setInput={setDraft}
          isProcessing={isProcessing}
          canSend={canSend}
          selectedModelRef={selectedModelRef}
          reasoningRef={reasoningRef}
          placeholder={apiKeyStatus === "configured" ? t("chat.askAnythingAboutYourCode") : t("chat.configureApiKey")}
          rows={1}
          referencedFiles={referencedFiles}
          imageAttachments={imageAttachments}
          onRemoveImageAttachment={removeImageAttachment}
          onImagePasteError={setRequestError}
          conversationId={conversationId}
          workspaceRevision={workspaceContext?.binding.revision}
          activeGenerationId={activeGenerationId}
          onSend={handleSend}
          footer={(
            <InputFooter
              reasoning={reasoning}
              selectedModel={selectedModel}
              permissionMode={permissionMode}
              permissionUpdatePending={isPermissionUpdatePending}
              onModelChange={handleModelChange}
              onReasoningChange={handleReasoningChange}
              onPermissionModeChange={handlePermissionModeChange}
              referencedFiles={referencedFiles}
              onRemoveReferencedFile={removeFile}
              conversationId={conversationId}
              usage={usageSummary.total}
              usageByModel={usageSummary.byModel}
              usageCurrency={usageCostCurrency}
              showUsage={usageBreakdown}
              contextWindow={contextWindowStatus}
              compaction={{
                pending: compaction.pending,
                result: compaction.result,
                onCompact: handleCompactContext,
              }}
            />
          )}
        />
      </div>
    </div>
  );
}

export default ChatView;

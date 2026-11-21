import { useEffect, useRef } from "react";
import type { VsCodeApi } from "@webview/VsCodeApi";
import { WEBVIEW_PROTOCOL_VERSION, type AssistantTimelineEvent, type ContextWindowStatus, type ConversationMessage, type HandlerToWebviewMessage, type AppConfig, type ImageAttachment, type StoredToolCall, type ToolCall } from "@/contracts";
import type { ConversationUsageSnapshot, UsageAggregate } from "@/shared/usage/Usage";
import type { ApiKeyStatus, DangerConfirmationData, ToolCallStatus } from "../ChatViewTypes";
import { setInterfaceLanguage } from "@webview/i18n";
import { acceptMessageForScope, type GenerationEventScopeSource } from "./GenerationEventScope";

type StreamDoneInfo = {
  status: "completed" | "cancelled" | "interrupted";
  finish_reason?: string;
  generationStopReason?: ConversationMessage["generationStopReason"];
};

export type MessageDispatcher = {
  onAddMessage?: (message: {
    role: string;
    content: string;
    wasStreamed?: boolean;
    toolCalls?: StoredToolCall[];
    timeline?: AssistantTimelineEvent[];
    toolCallId?: string;
    toolName?: string;
    usage?: UsageAggregate;
    imageAttachments?: ImageAttachment[];
    generationId: string;
  }) => void;
  onShowTyping?: (generationId?: string) => void;
  onStreamTimelineDelta?: (data: { generationId?: string; eventId: string; eventType: "reasoning" | "content"; content: string }) => void;
  onStreamTimelineToolGroup?: (event: Extract<AssistantTimelineEvent, { type: "tool-group" }>, generationId?: string) => void;
  onStreamDone?: (info: StreamDoneInfo & { generationId?: string }) => void;
  onStreamError?: (error: string, generationId?: string) => void;
  onClearChat?: () => void;
  onModelChanged?: (modelId: string) => void;
  onApiKeyStatus?: (status: ApiKeyStatus) => void;
  onConfigLoaded?: (config: Partial<AppConfig>, revision: number) => void;
  onConfigUpdateResult?: (message: Extract<HandlerToWebviewMessage, { type: "configUpdateResult" }>) => void;
  onToolCallStarted?: (data: { generationId?: string; toolCalls: ToolCall[]; round: number }) => void;
  onToolCallResult?: (data: { generationId?: string; toolCallId: string; toolName: string; result: string; isError?: boolean; rejected?: boolean; status: ToolCallStatus }) => void;
  onToolCallActionAccepted?: (data: { generationId?: string; toolCallId: string; status: "running" | "rejected" }) => void;
  onToolCallConfirmationRequired?: (data: { generationId?: string; toolCalls: ToolCall[]; round: number; autoExecute: boolean; dangerConfirmation?: DangerConfirmationData }) => void;
  onContextCompactionUpdated?: (data: { generationId: string; status: "compacting" | "completed" }) => void;
  onContextCompacted?: (data: { generationId: string }) => void;
  onContextWindowUpdated?: (data: { conversationId: string; contextWindow: ContextWindowStatus }) => void;
  onContextCompactionResult?: (data: { requestId: string; status: "compacted" | "empty" | "failed"; freedTokens?: number; error?: string }) => void;
  onGenerationRecoveryStarted?: (data: { generationId?: string; message: string }) => void;
  onResourceLimitReached?: (data: { generationId?: string; resource: string; error: string }) => void;
  onGenerationSnapshot?: (message: Extract<HandlerToWebviewMessage, { type: "generationSnapshot" }>) => void;
  onAssistantUsageUpdated?: (data: { generationId?: string; usage: UsageAggregate }) => void;
  onConversationUsageUpdated?: (data: { conversationId: string; usage: ConversationUsageSnapshot }) => void;
};

export function useMessageHandler(
  vscode: VsCodeApi | null,
  dispatcher: MessageDispatcher,
  scope?: GenerationEventScopeSource,
): void {
  const dispatcherRef = useRef(dispatcher);
  dispatcherRef.current = dispatcher;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    if (!vscode) {
      return;
    }

    const handleMessage = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (!acceptMessageForScope(message, scopeRef.current)) {
        return;
      }

      switch (message.type) {
        case "addMessage":
          dispatcherRef.current.onAddMessage?.(message.message);
          break;

        case "showTyping":
          dispatcherRef.current.onShowTyping?.(message.generationId);
          break;

        case "streamTimelineDelta":
          dispatcherRef.current.onStreamTimelineDelta?.({ generationId: message.generationId, eventId: message.eventId, eventType: message.eventType, content: message.content });
          break;

        case "streamTimelineToolGroup":
          dispatcherRef.current.onStreamTimelineToolGroup?.(message.event, message.generationId);
          break;

        case "streamDone":
          dispatcherRef.current.onStreamDone?.({
            status: message.status,
            finish_reason: message.finish_reason,
            generationStopReason: message.generationStopReason,
            generationId: message.generationId,
          });
          break;

        case "streamError":
          dispatcherRef.current.onStreamError?.(message.error, message.generationId);
          break;

        case "clearChat":
          dispatcherRef.current.onClearChat?.();
          break;

        case "modelChanged":
          dispatcherRef.current.onModelChanged?.(message.modelId);
          break;

        case "apiKeyStatus":
          dispatcherRef.current.onApiKeyStatus?.(message.status);
          break;

        case "configLoaded":
          if (message.config.interfaceLanguage) {setInterfaceLanguage(message.config.interfaceLanguage);}
          dispatcherRef.current.onConfigLoaded?.(message.config, message.revision);
          break;

        case "configUpdateResult":
          if (message.config.interfaceLanguage) {setInterfaceLanguage(message.config.interfaceLanguage);}
          dispatcherRef.current.onConfigUpdateResult?.(message);
          break;

        case "toolCallStarted":
          dispatcherRef.current.onToolCallStarted?.({
            generationId: message.generationId,
            toolCalls: message.toolCalls,
            round: message.round,
          });
          break;

        case "toolCallResult":
          dispatcherRef.current.onToolCallResult?.({
            generationId: message.generationId,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            result: message.result,
            isError: message.isError,
            rejected: message.rejected,
            status: message.status,
          });
          break;

        case "toolCallActionAccepted":
          dispatcherRef.current.onToolCallActionAccepted?.({ generationId: message.generationId, toolCallId: message.toolCallId, status: message.status });
          break;

        case "toolCallConfirmationRequired":
          dispatcherRef.current.onToolCallConfirmationRequired?.({
            generationId: message.generationId,
            toolCalls: message.toolCalls,
            round: message.round,
            autoExecute: message.autoExecute,
            dangerConfirmation: message.dangerConfirmation,
          });
          break;

        case "contextCompactionUpdated":
          dispatcherRef.current.onContextCompactionUpdated?.({ generationId: message.generationId, status: message.status });
          break;

        case "contextCompacted":
          dispatcherRef.current.onContextCompacted?.({ generationId: message.generationId });
          break;

        case "generationRecoveryStarted":
          dispatcherRef.current.onGenerationRecoveryStarted?.({ generationId: message.generationId, message: message.message });
          break;

        case "resourceLimitReached":
          dispatcherRef.current.onResourceLimitReached?.({ generationId: message.generationId, resource: message.resource, error: message.error });
          break;

        case "generationSnapshot":
          dispatcherRef.current.onGenerationSnapshot?.(message);
          break;

        case "assistantUsageUpdated":
          dispatcherRef.current.onAssistantUsageUpdated?.({ generationId: message.generationId, usage: message.usage });
          break;

        case "conversationUsageUpdated":
          dispatcherRef.current.onConversationUsageUpdated?.({ conversationId: message.conversationId, usage: message.usage });
          break;

        case "contextWindowUpdated":
          dispatcherRef.current.onContextWindowUpdated?.({
            conversationId: message.conversationId,
            contextWindow: message.contextWindow,
          });
          break;

        case "contextCompactionResult":
          dispatcherRef.current.onContextCompactionResult?.({
            requestId: message.requestId,
            status: message.status,
            freedTokens: message.freedTokens,
            error: message.error,
          });
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "initializeProtocol", protocolVersion: WEBVIEW_PROTOCOL_VERSION });
    vscode.postMessage({ type: "getConfig" });
    vscode.postMessage({ type: "getGenerationSnapshot" });

    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);
}

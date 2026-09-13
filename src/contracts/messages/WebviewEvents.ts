import type { ToolCall } from "../deepseek/Chat";
import type { ConversationUsageSnapshot, UsageAggregate } from "@/shared/usage/Usage";
import type {
  AssistantTimelineEvent,
  AvailableToolInfo,
  ContextWindowStatus,
  Conversation,
  ConversationMessage,
  ConversationSummary,
  DangerConfirmationData,
  GenerationSnapshot,
  PathCompletionItem,
  ProjectInstructionStatusSource,
  QueuedGenerationMessage,
  ReferencedFile,
  StoredToolCall,
  WebviewConfig,
  WorkspaceContextStatus,
  HistoryTransitionPhase,
  ImageAttachment,
} from "./WebviewModels";

export type HandlerToWebviewMessage =
  | { type: "protocolReady"; protocolVersion: 5 }
  | { type: "protocolError"; supportedVersion: 5; error: string }
  | { type: "requestRejected"; requestId?: string; action?: string; error: string }
  | { type: "configLoaded"; revision: number; config: Partial<WebviewConfig> }
  | {
      type: "historyTransitionRequired";
      requestId: string;
      phase: HistoryTransitionPhase;
      direction: "enter-incognito" | "exit-incognito";
      activeGenerations: number;
      queuedMessages: number;
    }
  | {
      type: "configUpdateResult";
      requestId: string;
      revision: number;
      operation: "save" | "reset";
      status: "success" | "error" | "cancelled";
      config: Partial<WebviewConfig>;
      credentialUpdated?: boolean;
      error?: string;
    }
  | { type: "connectionTestResult"; success: boolean; error?: string }
  | { type: "apiKeyDeleteResult"; requestId: string; status: "success" | "error" | "cancelled"; error?: string }
  | { type: "apiKeyStatusSettings"; status: "configured" | "missing"; keyPreview?: string }
  | { type: "apiKeyStatus"; status: "configured" | "missing"; keyPreview?: string }
  | { type: "generationAccepted"; generationId: string; conversationId: string; clientRequestId: string }
  | { type: "messageQueued"; conversationId: string; clientRequestId: string; position: number }
  | { type: "generationActivityChanged"; conversationId: string; generationId?: string; status: "queued" | "running" | "cancelling" | "settled"; queuedMessages: number }
  | { type: "cancelGenerationResult"; requestId: string; generationId: string; conversationId: string; status: "accepted" | "stale" }
  | { type: "newConversationReady"; requestId: string }
  | { type: "generationSnapshot"; generations: GenerationSnapshot[]; recoveredDrafts: Array<{ conversationId: string; messages: QueuedGenerationMessage[] }> }
  | { type: "contextCompactionUpdated"; generationId: string; conversationId: string; status: "compacting" | "completed" }
  | { type: "contextCompacted"; generationId: string; conversationId: string }
  | { type: "contextWindowUpdated"; conversationId: string; contextWindow: ContextWindowStatus }
  | {
      type: "contextCompactionResult";
      requestId: string;
      status: "compacted" | "empty" | "failed";
      freedTokens?: number;
      error?: string;
    }
  | { type: "generationRecoveryStarted"; generationId: string; conversationId: string; reason: "excessive_reasoning"; message: string }
  | { type: "resourceLimitReached"; generationId?: string; conversationId?: string; resource: string; error: string }
  | { type: "showTyping"; generationId: string; conversationId: string }
  | { type: "streamTimelineDelta"; generationId: string; conversationId: string; eventId: string; eventType: "reasoning" | "content"; content: string }
  | { type: "streamTimelineToolGroup"; generationId: string; conversationId: string; event: Extract<AssistantTimelineEvent, { type: "tool-group" }> }
  | {
      type: "streamDone";
      generationId: string;
      conversationId: string;
      status: "completed" | "cancelled" | "interrupted";
      finish_reason?: string;
      generationStopReason?: ConversationMessage["generationStopReason"];
    }
  | { type: "streamError"; generationId: string; conversationId: string; error: string }
  | {
      type: "addMessage";
      generationId: string;
      conversationId: string;
      message: {
        role: "user" | "assistant" | "tool";
        content: string;
        wasStreamed?: boolean;
        toolCalls?: StoredToolCall[];
        timeline?: AssistantTimelineEvent[];
        toolCallId?: string;
        toolName?: string;
        usage?: UsageAggregate;
        imageAttachments?: ImageAttachment[];
        generationId: string;
      };
    }
  | { type: "clearChat" }
  | { type: "projectInstructionsStatus"; generationId: string; conversationId: string; sources: ProjectInstructionStatusSource[]; homeAgentsAllowed: boolean }
  | { type: "workspaceContextChanged"; requestId?: string; conversationId?: string; context: WorkspaceContextStatus }
  | { type: "workspaceRebindResult"; success: boolean; context?: WorkspaceContextStatus; error?: string }
  | { type: "contextFilesSelected"; files: ReferencedFile[] }
  | { type: "pathCompletions"; requestId: number; query: string; workspaceRevision: string; items: PathCompletionItem[] }
  | { type: "modelChanged"; modelId: string }
  | { type: "history"; conversations: ConversationSummary[] }
  | { type: "historyError"; requestId?: string; error: string }
  | {
      type: "conversationLoaded";
      requestId: string;
      conversation: Conversation;
      usage?: ConversationUsageSnapshot;
      contextWindow?: ContextWindowStatus;
    }
  | { type: "conversationPageLoaded"; requestId: string; id: string; messages: Conversation["messages"]; hasEarlierMessages: boolean; cursor?: string }
  | { type: "conversationLoadRejected"; requestId: string }
  | { type: "conversationDeleted"; id: string }
  | { type: "toolCallStarted"; generationId: string; conversationId: string; toolCalls: ToolCall[]; round: number; totalRounds?: number }
  | {
      type: "toolCallResult";
      generationId: string;
      conversationId: string;
      toolCallId: string;
      toolName: string;
      result: string;
      isError?: boolean;
      rejected?: boolean;
      status: "completed" | "rejected" | "cancelled" | "error";
    }
  | { type: "toolCallActionAccepted"; generationId: string; conversationId: string; toolCallId: string; status: "running" | "rejected" }
  | {
      type: "toolCallConfirmationRequired";
      generationId: string;
      conversationId: string;
      toolCalls: ToolCall[];
      round: number;
      autoExecute: boolean;
      dangerConfirmation?: DangerConfirmationData;
    }
  | { type: "availableTools"; tools: AvailableToolInfo[] }
  | { type: "imageAttachmentsSelected"; requestId: string; attachments: ImageAttachment[]; error?: string }
  | { type: "imageAttachmentDeleted"; requestId: string; fileId: string; success: boolean; error?: string }
  | { type: "assistantUsageUpdated"; generationId: string; conversationId: string; usage: UsageAggregate }
  | { type: "conversationUsageUpdated"; conversationId: string; usage: ConversationUsageSnapshot };

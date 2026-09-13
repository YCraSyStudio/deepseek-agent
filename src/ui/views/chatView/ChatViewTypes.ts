import type { ConversationMessage, HandlerToWebviewMessage, StoredToolCall, DangerConfirmationData } from "@/contracts/messages/Webview";
import type { ContextWindowStatus, PermissionMode } from "@/contracts";
import type { ConversationUsageSnapshot, UsageCurrency } from "@/shared/usage/Usage";
import type { GenerationEventScope } from "./hooks/GenerationEventScope";

export type { StoredToolCall, DangerConfirmationData };

export type ChatMessage = ConversationMessage;

export type ApiKeyStatus = "missing" | "configured";

export type InitialConfig = {
  revision: number;
  provider?: string;
  reasoning?: string;
  model?: string;
  permissionMode?: PermissionMode;
  historyEnabled?: boolean;
  usageBreakdown?: boolean;
  usageCostCurrency?: UsageCurrency;
};

export type ToolCallAction = "execute" | "reject";
export type ToolCallStatus = "pending" | "awaiting_confirmation" | "running" | "completed" | "error" | "rejected" | "cancelled";

export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  arguments: string;
  status: ToolCallStatus;
  result?: string;
  round: number;
  requiresConfirmation?: boolean;
  dangerConfirmation?: DangerConfirmationData;
  rejected?: boolean;
  dangerLevel?: string;
  dangerConfirmed?: boolean;
}

export interface ToolCallGroup {
  id: string;
  round: number;
  toolCalls: ToolCallState[];
  expanded: boolean;
}

export type CodeAction = "copy" | "insert";

export type ContextCompactionResult = {
  status: "compacted" | "empty" | "failed";
  freedTokens?: number;
  error?: string;
};

export type ContextCompactionControls = {
  pending: boolean;
  result?: ContextCompactionResult;
  onCompact: () => void;
};

export type MessagesSectionProps = {
  getGenerationScope?: () => GenerationEventScope;
  conversationId?: string;
  activeGenerationId?: string;
  messages?: ChatMessage[];
  onMessagesChange?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isProcessing?: boolean;
  listRef?: React.RefObject<HTMLDivElement | null>;
  onApiKeyStatusChange?: (status: ApiKeyStatus) => void;
  onConfigLoaded?: (config: InitialConfig) => void;
  onConfigUpdateResult?: (message: Extract<HandlerToWebviewMessage, { type: "configUpdateResult" }>) => void;
  permissionUpdatePending?: boolean;
  earlierMessagesLoaded?: number;
  historyCursor?: string;
  onModelChanged?: (modelId: string) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onConversationUsageUpdated?: (usage: ConversationUsageSnapshot) => void;
  onContextWindowUpdated?: (contextWindow: ContextWindowStatus) => void;
  onContextCompactionResult?: (result: { requestId: string; status: "compacted" | "empty" | "failed"; freedTokens?: number; error?: string }) => void;
  onFocusInput?: () => void;
};
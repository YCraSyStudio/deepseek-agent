import type { AppConfig, AssistantTimelineEvent, ChatMessage, PermissionSnapshot, ToolCall, ToolDefinition } from "@/contracts";
import type { ToolCallCycleResult } from "@/application/chat/toolCall";
import type { ToolExecutor } from "@/application/tools/ToolExecutor";
import type { ConfirmationRequiredResult, ExecutionResult } from "@/application/tools/Types";
import type { StreamEventEmitter } from "../streaming/StreamEventEmitter";
import type { ProviderTranscript } from "@/application/chat/ProviderTranscript";
import type { CommandSafetyReview } from "@/infrastructure/deepseek/security/commandReview";
import type { ProviderUsage, UsagePhase } from "@/shared/usage/Usage";
import type { GenerationEventSink } from "@/application/ports";
import type { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";

export interface PendingToolCallCycle {
  toolCalls: Map<string, ToolCall>;
  round: number;
  individualResolves: Map<string, (action: ToolCallAction) => void>;
  individualPromises: Map<string, Promise<ToolCallAction>>;
  resolved: Set<string>;
}

export interface PendingDangerConfirmation {
  toolCall: ToolCall;
  resolve: (decision: DangerConfirmationDecision) => void;
  confirmationResult: ConfirmationRequiredResult;
}

export type ToolCallAction = "execute" | "reject";
export interface ToolCallActionPayload {
  toolCallId: string;
  action: ToolCallAction;
}

export interface DangerConfirmationDecision {
  confirmed: boolean;
}

export interface StoredExecution {
  toolCallId: string;
  toolName: string;
  arguments: string;
  result?: string;
  isError?: boolean;
  round?: number;
  rejected?: boolean;
  requiresConfirmation?: boolean;
  dangerLevel?: string;
  dangerConfirmed?: boolean;
  status: "pending" | "awaiting_confirmation" | "running" | "completed" | "rejected" | "cancelled" | "error";
}

export interface ToolCallRunOptions {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  providerConfig: AppConfig;
  eventSink: GenerationEventSink<Record<string, unknown>>;
  permissionSnapshot: PermissionSnapshot;
  capturePermissionSnapshot: () => Promise<PermissionSnapshot>;
  onPermissionSnapshot?: (snapshot: PermissionSnapshot) => void;
  onTranscriptUpdate?: (transcript: ProviderTranscript) => void;
  onUsage?: (phase: UsagePhase, usage: ProviderUsage | undefined, model: string) => void;
  exposeReasoning: boolean;
  signal?: AbortSignal;
  isCancelling: () => boolean;
  isWorkspaceTrusted: () => boolean;
  generationId: string;
  conversationId?: string;
  trustedUserRequest: string;
  authorizedUserUrls: readonly string[];
  budgetManager: GenerationBudgetManager;
  onContextCompacted?: (data: { estimatedTokensBefore: number; estimatedTokensAfter: number }) => Promise<void> | void;
  analyzeImages?: (question: string, imageIds: string[], signal?: AbortSignal) => Promise<string>;
}

export interface ToolCallRunResult {
  content: string;
  timeline: AssistantTimelineEvent[];
  toolCalls?: StoredExecution[];
  partial?: boolean;
  providerTranscript?: ProviderTranscript;
}

export interface ToolExecutionContext {
  toolExecutor: ToolExecutor;
  eventSink: GenerationEventSink<Record<string, unknown>>;
  executedToolCalls: Map<string, StoredExecution>;
  signal?: AbortSignal;
  autoApproveMode: boolean;
  fullAccessMode: boolean;
  isWorkspaceTrusted: () => boolean;
  getCurrentRound: () => number;
  getPendingCycle: () => PendingToolCallCycle | null;
  requestDangerConfirmation: (
    toolCall: ToolCall,
    confirmationResult: ConfirmationRequiredResult,
    options?: { announceStarted?: boolean; round?: number },
  ) => Promise<DangerConfirmationDecision>;
  reviewDangerousCommand: (
    toolCall: ToolCall,
    confirmationResult: ConfirmationRequiredResult,
  ) => Promise<CommandSafetyReview>;
  generationId?: string;
  trustedUserRequest?: string;
  availableToolNames?: readonly string[];
  authorizedUserUrls?: readonly string[];
  isWebTainted?: () => boolean;
  markWebTainted?: () => void;
  conversationId?: string;
  permissionFingerprint?: string;
  analyzeImages?: (question: string, imageIds: string[], signal?: AbortSignal) => Promise<string>;
}

export interface HandleExecutionResultOptions {
  toolCall: ToolCall;
  result: ExecutionResult;
  ctx: ToolExecutionContext;
  announceStarted?: boolean;
  round: number;
}

export interface PostFinalMessageOptions {
  options: ToolCallRunOptions;
  stream: StreamEventEmitter;
  result: ToolCallCycleResult;
  executedToolCalls: Map<string, StoredExecution>;
  streamedContent: string;
}

export interface HandleRunErrorOptions {
  err: unknown;
  options: ToolCallRunOptions;
  stream: StreamEventEmitter;
  executedToolCalls: Map<string, StoredExecution>;
  streamedContent: string;
}

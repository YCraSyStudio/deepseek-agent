import type { ChatCompletionResponse, ChatMessage, ReasoningEffort, ToolCall, ToolDefinition } from "@/contracts";
import type { ProviderUsage } from "@/shared/usage/Usage";
import type { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";

export interface ToolCallResult {
  role: "tool";
  tool_call_id: string;
  content: string;
  name: string;
}

export interface ToolCallCycleOptions {
  getToolsForRound?: (phase: "reasoning" | "tools", round: number) => Promise<ToolDefinition[]> | ToolDefinition[];
  onRoundStart?: (round: number, toolCalls: ToolCall[]) => Promise<void> | void;
  onToolResult?: (toolCallId: string, result: string) => void;
  onTranscriptUpdate?: (messages: ChatMessage[], status: "complete" | "incomplete") => void;
  onUsage?: (usage?: ProviderUsage) => void;
  prepareRequestContext?: (
    messages: ChatMessage[],
    tools: ToolDefinition[],
    round: number,
  ) => Promise<ChatMessage[] | undefined> | ChatMessage[] | undefined;
  validateRequestBudget?: (messages: ChatMessage[], tools: ToolDefinition[]) => void;
  signal?: AbortSignal;
  streamFinalResponse?: boolean;
  streamToolCallRounds?: boolean;
  onStreamChunk?: (content: string) => void;
  onStreamReasoning?: (content: string) => void;
  thinkingMode?: boolean;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  userId?: string;
  budgetManager?: GenerationBudgetManager;
  onRecoveryStarted?: () => Promise<void> | void;
  reviewCompletion?: (context: CompletionReviewContext) => Promise<CompletionReviewDecision>;
  reviewProgress?: (context: ProgressReviewContext) => Promise<ProgressReviewResult>;
  progressReviewInterval?: number;
}

export type CompletionReviewDecision = "complete" | "incomplete" | "unknown";

export interface CompletionReviewContext {
  messages: ChatMessage[];
  candidate: ChatMessage;
  toolCallsExecuted: number;
  recoveryAttempted: boolean;
}

type ProgressReviewDecision = "continue" | "finalize" | "blocked" | "unknown";
type ProgressReviewConfidence = "high" | "medium" | "low";

export interface ProgressReviewResult {
  decision: ProgressReviewDecision;
  confidence: ProgressReviewConfidence;
  reason: string;
  nextAction?: string;
}

export interface ProgressReviewContext {
  messages: ChatMessage[];
  completedRounds: number;
  toolCallsExecuted: number;
  reviewsCompleted: number;
}

export interface ToolCallCycleResult {
  finalMessage: ChatMessage;
  rounds: number;
  toolCallsExecuted: number;
  response: ChatCompletionResponse;
  transcript: ChatMessage[];
}

type ToolExecutor = (toolCall: ToolCall) => Promise<string>;

interface ToolCallModelRoundOptions {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  model: string;
  cycleOptions: ToolCallCycleOptions;
  emitStreamEvents?: boolean;
}

export interface ToolCallModelClient {
  completeRound(options: ToolCallModelRoundOptions): Promise<ChatCompletionResponse>;
  streamRound(options: ToolCallModelRoundOptions): Promise<ChatCompletionResponse>;
}

export interface RunToolCallCycleOptions {
  initialMessages: ChatMessage[];
  tools: ToolDefinition[];
  model: string;
  modelClient: ToolCallModelClient;
  executeToolCall: ToolExecutor;
  cycleOptions?: ToolCallCycleOptions;
}

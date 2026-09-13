import type { ToolDefinition } from "@/contracts";
import type { ToolExecutionOutcome } from "@/domain/tools/ToolExecutionOutcome";

export type DangerLevel = "safe" | "caution" | "dangerous" | "destructive";

export type ToolEffect = "read-only" | "workspace-mutation" | "external-effect";

export interface ToolMetadata {
  dangerLevel: DangerLevel;
  warningMessage?: string;
  requiresConfirmation: boolean;
  scope?: "workspace" | "global";
  effect?: ToolEffect;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>, context?: ToolHandlerContext) => Promise<string>;
  forcedHandler?: (args: Record<string, unknown>, context?: ToolHandlerContext) => Promise<string>;
  metadata: ToolMetadata;
}

export interface ToolHandlerContext {
  signal?: AbortSignal;
  generationId?: string;
  trustedUserRequest?: string;
  availableToolNames?: readonly string[];
  authorizedUserUrls?: readonly string[];
  webTainted?: boolean;
  analyzeImages?: (question: string, imageIds: string[], signal?: AbortSignal) => Promise<string>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ExecutionResult {
  toolCallId: string;
  toolName: string;
  outcome: ToolExecutionOutcome;
  status: "completed" | "error" | "confirmation_required" | "rejected" | "cancelled";
}

export interface ConfirmationRequiredResult {
  requiresConfirmation: true;
  dangerLevel: DangerLevel;
  warningMessage: string;
  command?: string;
  filePath?: string;
  cwd?: string;
  workspaceRoot?: string;
  shell?: string;
  beforeHash?: string;
  reasonCode?: string;
  normalizedCommand?: string;
  workspaceContained?: boolean;
}

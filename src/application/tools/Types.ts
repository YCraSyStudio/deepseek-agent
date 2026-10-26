import type { CaptureScreenshotRequest, CaptureScreenshotResult } from "@/contracts/Capture";
import type { ToolDefinition } from "@/contracts";
import type { ToolExecutionOutcome } from "@/domain/tools/ToolExecutionOutcome";
import type { CodeCompletionRequest } from "@/contracts/CodeCompletion";
import type { ApplicationSessionRequest, ApplicationSessionResult } from "@/contracts/ApplicationSession";

export type DangerLevel = "safe" | "caution" | "dangerous" | "destructive";

export type ToolEffect = "read-only" | "workspace-mutation" | "external-effect";

export interface ToolMetadata {
  dangerLevel: DangerLevel;
  warningMessage?: string;
  requiresConfirmation: boolean;
  scope?: "workspace" | "global";
  effect?: ToolEffect;
  alwaysConfirmWhen?: { argument: string; values: readonly string[] };
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>, context?: ToolHandlerContext) => Promise<string>;
  forcedHandler?: (args: Record<string, unknown>, context?: ToolHandlerContext) => Promise<string>;
  metadata: ToolMetadata;
}

export interface AnalyzeImagesRequest {
  question: string;
  attachmentIds?: string[];
  screenshotIds?: string[];
  paths?: string[];
}
export interface ToolHandlerContext {
  signal?: AbortSignal;
  generationId?: string;
  trustedUserRequest?: string;
  availableToolNames?: readonly string[];
  authorizedUserUrls?: readonly string[];
  webTainted?: boolean;
  captureScreenshot?: (request: CaptureScreenshotRequest, signal?: AbortSignal) => Promise<CaptureScreenshotResult>;
  analyzeImages?: (request: AnalyzeImagesRequest, signal?: AbortSignal) => Promise<string>;
  completeCode?: (request: CodeCompletionRequest, signal?: AbortSignal) => Promise<string>;
  readInstruction?: (id: string, signal?: AbortSignal) => Promise<string>;
  revertWorkspace?: (generationId?: string) => Promise<string>;
  applicationSession?: (request: ApplicationSessionRequest) => Promise<ApplicationSessionResult>;
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

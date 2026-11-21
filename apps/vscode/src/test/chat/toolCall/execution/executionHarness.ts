import type { ToolCall } from "@/contracts";
import { createExecutionResult } from "@/application/tools/ToolExecutor";
import type { ToolExecutor } from "@/application/tools/ToolExecutor";
import type { ToolMetadata } from "@/application/tools/Types";
import type { CommandSafetyReview } from "@/infrastructure/deepseek/security/commandReview";
import type { ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { PendingToolCallCycle, ToolExecutionContext } from "@/vscode/webviews/handlers/chat/toolCalls/Types";

export function toolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call:${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

export function createToolExecutorStub(options: {
  confirmation?: string;
  forcedResult?: string;
  metadata?: Record<string, ToolMetadata>;
} = {}): { executor: ToolExecutor; executionCalls: ToolCall[]; forcedCalls: ToolCall[] } {
  const executionCalls: ToolCall[] = [];
  const forcedCalls: ToolCall[] = [];
  const executor = {
    execute: async (toolCall: ToolCall) => {
      executionCalls.push(toolCall);
      return options.confirmation
        ? createExecutionResult(toolCall, { kind: "confirmation_required", content: options.confirmation, dangerLevel: "caution" })
        : createExecutionResult(toolCall, { kind: "completed", content: "completed" });
    },
    executeForced: async (toolCall: ToolCall) => {
      forcedCalls.push(toolCall);
      return createExecutionResult(toolCall, { kind: "completed", content: options.forcedResult ?? "completed" });
    },
    getMetadata: (name: string): ToolMetadata | undefined => options.metadata?.[name],
  } as unknown as ToolExecutor;
  return { executor, executionCalls, forcedCalls };
}

export function createExecutionContext(options: {
  executor?: ToolExecutor;
  permissionMode?: "default" | "auto-approve" | "full-access";
  trusted?: boolean;
  round?: number;
  pendingCycle?: PendingToolCallCycle | null;
  confirmDanger?: boolean;
  review?: () => CommandSafetyReview;
} = {}): {
  context: ToolExecutionContext;
  published: Array<Record<string, unknown>>;
  publishedResults: string[];
  confirmations: () => number;
  reviews: () => number;
  webTainted: () => boolean;
} {
  let webTainted = false;
  let confirmations = 0;
  let reviews = 0;
  const published: Array<Record<string, unknown>> = [];
  const publishedResults: string[] = [];
  const context: ToolExecutionContext = {
    toolExecutor: options.executor ?? createToolExecutorStub().executor,
    eventSink: {
      publish: (event) => {
        published.push(event);
        if (event.type === "toolCallResult" && typeof event.result === "string") {
          publishedResults.push(event.result);
        }
      },
    },
    executedToolCalls: new Map(),
    autoApproveMode: options.permissionMode === "auto-approve",
    fullAccessMode: options.permissionMode === "full-access",
    isWorkspaceTrusted: () => options.trusted ?? true,
    getCurrentRound: () => options.round ?? 1,
    getPendingCycle: () => options.pendingCycle ?? null,
    requestDangerConfirmation: async () => {
      confirmations += 1;
      return { confirmed: options.confirmDanger ?? false };
    },
    reviewDangerousCommand: async () => {
      reviews += 1;
      return options.review?.() ?? {
        decision: "manual_confirmation",
        risk: "elevated",
        confidence: "very_low",
        reason: "no review stub",
      };
    },
    isWebTainted: () => webTainted,
    markWebTainted: () => {
      webTainted = true;
    },
    conversationId: "conversation:test",
    permissionFingerprint: "fingerprint:test",
  };
  return {
    context,
    published,
    publishedResults,
    confirmations: () => confirmations,
    reviews: () => reviews,
    webTainted: () => webTainted,
  };
}

export function createWorkspaceHost(options: {
  contained?: boolean;
  onClearPreview?: () => void;
} = {}): ToolWorkspaceHost {
  return {
    getRootPath: () => "/workspace",
    getWorkspaceId: () => "workspace:test",
    isPathInsideWorkspace: async () => options.contained ?? true,
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    stat: async () => ({ type: "file", size: 0 }),
    createParentDirectory: async () => undefined,
    readDirectory: async () => [],
    clearFileDiffPreview: () => options.onClearPreview?.(),
  } as unknown as ToolWorkspaceHost;
}

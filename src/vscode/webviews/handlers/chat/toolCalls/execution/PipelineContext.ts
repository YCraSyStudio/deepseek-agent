import type { ToolCall } from "@/contracts";
import type { ConfirmationRequiredResult, ToolHandlerContext } from "@/application/tools/Types";
import { getToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { ToolExecutionContext } from "../Types";

const FILE_PATH_TOOLS = new Set(["read_file", "read_func", "list_directory", "create_file", "edit_file", "apply_patch", "move_path", "delete_path"]);
const WORKSPACE_SCOPED_FILE_TOOLS = ["create_file", "edit_file", "apply_patch", "move_path", "delete_path"];

export function handlerContext(ctx: ToolExecutionContext): ToolHandlerContext {
  return {
    signal: ctx.signal,
    generationId: ctx.generationId,
    trustedUserRequest: ctx.trustedUserRequest,
    availableToolNames: ctx.availableToolNames,
    authorizedUserUrls: ctx.authorizedUserUrls,
    webTainted: ctx.isWebTainted?.(),
    analyzeImages: ctx.analyzeImages,
  };
}

export function isAutomaticExecution(ctx: ToolExecutionContext): boolean {
  return ctx.fullAccessMode || ctx.autoApproveMode;
}

export function requiresWorkspaceMutationPolicy(ctx: ToolExecutionContext, toolCall: ToolCall): boolean {
  const metadata = ctx.toolExecutor.getMetadata(toolCall.function.name);
  return metadata?.scope !== "global" && metadata?.effect !== "read-only";
}

export function getPathArgument(toolCall: ToolCall): string | undefined {
  if (!FILE_PATH_TOOLS.has(toolCall.function.name) && toolCall.function.name !== "run_terminal_command") {
    return undefined;
  }
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    const value = toolCall.function.name === "run_terminal_command" ? args.cwd : args.path;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function addProvenFileScope(
  toolCall: ToolCall,
  confirmation: ConfirmationRequiredResult,
): Promise<ConfirmationRequiredResult> {
  if (!WORKSPACE_SCOPED_FILE_TOOLS.includes(toolCall.function.name)) {return confirmation;}
  const filePath = confirmation.filePath ?? getPathArgument(toolCall);
  const requiresDestination = toolCall.function.name === "move_path";
  const destination = requiresDestination ? getDestinationArgument(toolCall) : undefined;
  const workspace = getToolWorkspaceHost();
  const contained = await isContainedInWorkspace(workspace, filePath)
    && (!requiresDestination || await isContainedInWorkspace(workspace, destination));
  return {
    ...confirmation,
    filePath,
    workspaceRoot: confirmation.workspaceRoot ?? workspace.getRootPath?.(),
    workspaceContained: contained,
    ...(contained ? {} : { reasonCode: "outside-workspace" }),
  };
}

async function isContainedInWorkspace(workspace: ToolWorkspaceHost, target: string | undefined): Promise<boolean> {
  if (!target || !workspace.isPathInsideWorkspace) {
    return false;
  }
  return workspace.isPathInsideWorkspace(target);
}

function getDestinationArgument(toolCall: ToolCall): string | undefined {
  if (toolCall.function.name !== "move_path") {return undefined;}
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    const value = args.destination;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}
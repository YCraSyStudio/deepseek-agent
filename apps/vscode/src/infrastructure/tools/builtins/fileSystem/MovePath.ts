import { createHash } from "crypto";
import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import { getToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { getErrorMessage } from "@/shared/utils/Errors";
import { createStructuredResult, isMissingFileError } from "./StructuredResult";

const MAX_PATH_CHARACTERS = 1024;

interface MovePathArgs {
  path: string;
  destination: string;
  expectedBeforeHash?: string;
}

interface MovePathPreview {
  sourceKind: "file" | "directory" | "unknown";
  beforeHash?: string;
}

async function handleMovePath(args: Record<string, unknown>): Promise<string> {
  const parsed = parseMovePathArgs(args);
  if (typeof parsed === "string") {
    return parsed;
  }

  const preview = await prepareMove(parsed);
  if (typeof preview === "string") {
    return preview;
  }

  return JSON.stringify({
    requiresConfirmation: true,
    dangerLevel: "caution",
    warningMessage: `Move ${preview.sourceKind} "${parsed.path}" to "${parsed.destination}"?`,
    filePath: parsed.path,
    ...(preview.beforeHash ? { beforeHash: preview.beforeHash } : {}),
  });
}

async function handleMovePathForced(args: Record<string, unknown>): Promise<string> {
  const parsed = parseMovePathArgs(args);
  if (typeof parsed === "string") {
    return parsed;
  }

  const preview = await prepareMove(parsed);
  if (typeof preview === "string") {
    return preview;
  }

  try {
    const workspace = getToolWorkspaceHost();
    if (!workspace.movePath) {
      return `Error moving '${parsed.path}': the active workspace host does not support moving paths`;
    }
    await workspace.movePath(parsed.path, { destination: parsed.destination, overwrite: false });
    return createStructuredResult("fileMove", {
      path: parsed.path,
      destination: parsed.destination,
      sourceKind: preview.sourceKind,
      beforeHash: preview.beforeHash,
      summary: `Moved ${preview.sourceKind} ${parsed.path} to ${parsed.destination}`,
    });
  } catch (err: unknown) {
    return `Error moving '${parsed.path}': ${getErrorMessage(err)}`;
  }
}

async function prepareMove(args: MovePathArgs): Promise<MovePathPreview | string> {
  try {
    const workspace = getToolWorkspaceHost();
    if (isWorkspaceRoot(args.path) || isWorkspaceRoot(args.destination)) {
      return `Error moving '${args.path}': the workspace root cannot be moved`;
    }
    if (await pathExists(workspace, args.destination)) {
      return `Error moving '${args.path}': destination '${args.destination}' already exists. move_path never overwrites; choose a destination that does not exist.`;
    }

    const source = await workspace.stat(args.path);
    if (source.type !== "file") {
      return { sourceKind: source.type };
    }

    const content = await workspace.readFile(args.path);
    const beforeHash = createHash("sha256").update(content).digest("hex");
    if (args.expectedBeforeHash && args.expectedBeforeHash !== beforeHash) {
      return `Error moving '${args.path}': file changed after confirmation. Expected sha256 ${args.expectedBeforeHash}, got ${beforeHash}.`;
    }
    return { sourceKind: source.type, beforeHash };
  } catch (err: unknown) {
    return `Error moving '${args.path}': ${getErrorMessage(err)}`;
  }
}

async function pathExists(workspace: ToolWorkspaceHost, target: string): Promise<boolean> {
  try {
    await workspace.stat(target);
    return true;
  } catch (err: unknown) {
    if (isMissingFileError(err)) {
      return false;
    }
    throw err;
  }
}

function isWorkspaceRoot(target: string): boolean {
  const normalized = target.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === "" || normalized === "." ;
}

function parseMovePathArgs(args: Record<string, unknown>): MovePathArgs | string {
  const source = args.path;
  const destination = args.destination;
  const expectedBeforeHash = typeof args.expectedBeforeHash === "string" ? args.expectedBeforeHash : undefined;

  if (typeof source !== "string" || source.trim() === "") {
    return "Error: path parameter is required";
  }
  if (typeof destination !== "string" || destination.trim() === "") {
    return "Error: destination parameter is required";
  }
  if (source.length > MAX_PATH_CHARACTERS || destination.length > MAX_PATH_CHARACTERS) {
    return `Error: paths longer than ${MAX_PATH_CHARACTERS} characters are not supported`;
  }
  if (normalizePath(source) === normalizePath(destination)) {
    return `Error moving '${source}': source and destination are the same path`;
  }

  return { path: source, destination, expectedBeforeHash };
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export const movePathDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "move_path",
    description:
      "Move or rename a file or directory inside the workspace. The destination must not exist: this tool never overwrites. Moving to a path inside a clean Git repository is treated as recoverable.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the file or directory to move. Use an absolute path only for explicitly requested external access.",
        },
        destination: {
          type: "string",
          description: "Workspace-relative destination path. The parent directory is created automatically and the destination must not exist.",
        },
        expectedBeforeHash: {
          type: "string",
          description: "Optional sha256 used to reject the move if the source file changed after preview.",
        },
      },
      required: ["path", "destination"],
      additionalProperties: false,
    },
  },
};

export const movePathHandler: RegisteredTool["handler"] = handleMovePath;
export const movePathHandlerForced: RegisteredTool["handler"] = handleMovePathForced;

export const movePathMetadata: ToolMetadata = {
  dangerLevel: "caution",
  warningMessage: "This moves or renames a workspace path.",
  requiresConfirmation: true,
  scope: "workspace",
};

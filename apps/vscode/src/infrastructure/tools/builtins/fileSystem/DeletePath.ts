import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import { getToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { getErrorMessage } from "@/shared/utils/Errors";
import { createStructuredResult, isMissingFileError } from "./StructuredResult";

const MAX_PATH_CHARACTERS = 1024;

interface DeletePathArgs {
  path: string;
  recursive: boolean;
  permanent: boolean;
}

interface DeletePathPreview {
  entryType: "file" | "directory" | "path";
  entryCount?: number;
}

async function handleDeletePath(args: Record<string, unknown>): Promise<string> {
  const parsed = parseDeletePathArgs(args);
  if (typeof parsed === "string") {
    return parsed;
  }

  const preview = await prepareDelete(parsed);
  if (typeof preview === "string") {
    return preview;
  }

  const action = parsed.permanent ? "Permanently delete" : "Move to the trash";
  const contents = preview.entryCount === undefined
    ? ""
    : ` and its ${preview.entryCount} entr${preview.entryCount === 1 ? "y" : "ies"}`;
  return JSON.stringify({
    requiresConfirmation: true,
    dangerLevel: parsed.permanent ? "destructive" : "dangerous",
    warningMessage: `${action} ${preview.entryType} "${parsed.path}"${contents}?`,
    filePath: parsed.path,
  });
}

async function handleDeletePathForced(args: Record<string, unknown>): Promise<string> {
  const parsed = parseDeletePathArgs(args);
  if (typeof parsed === "string") {
    return parsed;
  }

  const preview = await prepareDelete(parsed);
  if (typeof preview === "string") {
    return preview;
  }

  try {
    const workspace = getToolWorkspaceHost();
    if (!workspace.deletePath) {
      return `Error deleting '${parsed.path}': the active workspace host does not support deleting paths`;
    }
    await workspace.deletePath(parsed.path, { recursive: parsed.recursive, useTrash: !parsed.permanent });
    return createStructuredResult("fileDelete", {
      path: parsed.path,
      entryType: preview.entryType,
      entryCount: preview.entryCount,
      permanent: parsed.permanent,
      summary: parsed.permanent
        ? `Permanently deleted ${preview.entryType} ${parsed.path}`
        : `Moved ${preview.entryType} ${parsed.path} to the trash`,
    });
  } catch (err: unknown) {
    return `Error deleting '${parsed.path}': ${getErrorMessage(err)}`;
  }
}

async function prepareDelete(args: DeletePathArgs): Promise<DeletePathPreview | string> {
  try {
    const workspace: ToolWorkspaceHost = getToolWorkspaceHost();
    if (isWorkspaceRoot(args.path)) {
      return `Error deleting '${args.path}': the workspace root cannot be deleted`;
    }

    const metadata = await workspace.stat(args.path);
    if (metadata.type !== "directory") {
      return { entryType: metadata.type === "file" ? "file" : "path" };
    }
    if (!args.recursive) {
      return `Error deleting '${args.path}': it is a directory. Set recursive to true to delete the directory and everything inside it.`;
    }

    const entries = await workspace.readDirectory(args.path);
    return { entryType: "directory", entryCount: entries.length };
  } catch (err: unknown) {
    if (isMissingFileError(err)) {
      return `Error deleting '${args.path}': the path does not exist`;
    }
    return `Error deleting '${args.path}': ${getErrorMessage(err)}`;
  }
}

function isWorkspaceRoot(target: string): boolean {
  const normalized = target.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === "" || normalized === ".";
}

function parseDeletePathArgs(args: Record<string, unknown>): DeletePathArgs | string {
  const target = args.path;
  const recursive = args.recursive ?? false;
  const permanent = args.permanent ?? false;

  if (typeof target !== "string" || target.trim() === "") {
    return "Error: path parameter is required";
  }
  if (target.length > MAX_PATH_CHARACTERS) {
    return `Error: paths longer than ${MAX_PATH_CHARACTERS} characters are not supported`;
  }
  if (typeof recursive !== "boolean") {
    return "Error: recursive parameter must be a boolean when provided";
  }
  if (typeof permanent !== "boolean") {
    return "Error: permanent parameter must be a boolean when provided";
  }

  return { path: target, recursive, permanent };
}

export const deletePathDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "delete_path",
    description:
      "Delete a file or directory. Files are sent to the trash unless permanent is true; deleting a directory requires recursive true. Deletion inside a clean Git repository is treated as recoverable, otherwise it needs confirmation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the file or directory to delete. Use an absolute path only for explicitly requested external access.",
        },
        recursive: {
          type: "boolean",
          description: "Required when the path is a directory. Never inferred: without it a directory deletion fails.",
        },
        permanent: {
          type: "boolean",
          description: "Delete permanently instead of sending the path to the trash. Defaults to false.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

export const deletePathHandler: RegisteredTool["handler"] = handleDeletePath;
export const deletePathHandlerForced: RegisteredTool["handler"] = handleDeletePathForced;

export const deletePathMetadata: ToolMetadata = {
  dangerLevel: "destructive",
  warningMessage: "This removes a file or directory from the workspace.",
  requiresConfirmation: true,
  scope: "workspace",
};

import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { getErrorMessage } from "@/shared/utils/Errors";

const MAX_DIRECTORY_ENTRIES = 500;
const MAX_DIRECTORY_OUTPUT_BYTES = 64 * 1024;

async function handleListDir(args: Record<string, unknown>): Promise<string> {
  const dirPath = (args.path as string) || ".";
  const showHidden = (args.showHidden as boolean) || false;

  try {
    const entries = await getToolWorkspaceHost().readDirectory(dirPath);
    const excluded = new Set(["node_modules", ".git", ".vscode", "dist", "build"]);

    const allItems = entries
      .filter(([name]) => showHidden || !name.startsWith("."))
      .filter(([name]) => !excluded.has(name))
      .map(([name, type]) => {
        const icon = type === "directory" ? "[dir]" : "[file]";
        return `${icon} ${name}`;
      });

    if (allItems.length === 0) {
      return `(empty directory: ${dirPath})`;
    }

    const items: string[] = [];
    let bytes = Buffer.byteLength(`Contents of ${dirPath}:\n`, "utf8");
    for (const item of allItems.slice(0, MAX_DIRECTORY_ENTRIES)) {
      const itemBytes = Buffer.byteLength(`${item}\n`, "utf8");
      if (bytes + itemBytes > MAX_DIRECTORY_OUTPUT_BYTES) {break;}
      items.push(item);
      bytes += itemBytes;
    }
    const truncated = items.length < allItems.length;
    return `Contents of ${dirPath}:\n${items.join("\n")}${truncated ? `\n...[directory truncated; ${allItems.length - items.length} entries omitted]` : ""}`;
  } catch (err: unknown) {
    return `Error listing directory '${dirPath}': ${getErrorMessage(err)}`;
  }
}

export const listDirDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List files and directories at a project path. Excludes node_modules, .git, dist, build, and hidden files by default.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path. Defaults to the root. Use an absolute path only for explicitly requested external access.",
        },
        showHidden: {
          type: "boolean",
          description: "Show hidden files, meaning files whose names start with a dot.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const listDirHandler: RegisteredTool["handler"] = handleListDir;

export const listDirMetadata: ToolMetadata = {
  dangerLevel: "safe",
  requiresConfirmation: false,
};

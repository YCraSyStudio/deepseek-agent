import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { getErrorMessage } from "@/shared/utils/Errors";
import { bufferLooksBinary, createStructuredResult, createUnifiedDiff } from "./StructuredResult";
import { createHash } from "crypto";
import { findLineEndingInsensitiveRanges, normalizeReplacementLineEndings, type TextRange } from "./LineEndings";

const MAX_MUTATION_FILE_BYTES = 16 * 1024 * 1024;

interface EditFileArgs {
  path: string;
  search: string;
  replace: string;
  replaceAll: boolean;
  expectedBeforeHash?: string;
}

async function handleEditFile(args: Record<string, unknown>): Promise<string> {
  const parsed = parseEditFileArgs(args);
  if (typeof parsed === "string") {
    return parsed;
  }

  const preview = await prepareEdit(parsed, { showDiffPreview: true });
  if (typeof preview === "string") {
    return preview;
  }

  return JSON.stringify({
    requiresConfirmation: true,
    dangerLevel: "caution",
    warningMessage: `Apply ${preview.replacementCount} replacement${preview.replacementCount === 1 ? "" : "s"} to "${parsed.path}"?`,
    filePath: parsed.path,
    beforeHash: preview.beforeHash,
  });
}

async function handleEditFileForced(args: Record<string, unknown>): Promise<string> {
  const parsed = parseEditFileArgs(args);
  if (typeof parsed === "string") {
    return parsed;
  }

  const preview = await prepareEdit(parsed, { showDiffPreview: false });
  if (typeof preview === "string") {
    return preview;
  }

  try {
    await getToolWorkspaceHost().writeFile(parsed.path, Buffer.from(preview.after, "utf-8"));
    return createStructuredResult("fileEdit", {
      path: parsed.path,
      replacementCount: preview.replacementCount,
      beforeHash: preview.beforeHash,
      afterHash: createHash("sha256").update(preview.after, "utf-8").digest("hex"),
      diff: preview.diff.content,
      diffTruncated: preview.diff.truncated,
      diffStats: preview.diff.stats,
      beforeSize: Buffer.byteLength(preview.before, "utf-8"),
      afterSize: Buffer.byteLength(preview.after, "utf-8"),
      summary: `Edited ${parsed.path}: ${preview.replacementCount} replacement${preview.replacementCount === 1 ? "" : "s"}`,
    });
  } catch (err: unknown) {
    return `Error editing file '${parsed.path}': ${getErrorMessage(err)}`;
  }
}

async function prepareEdit(
  args: EditFileArgs,
  options: { showDiffPreview: boolean },
): Promise<
  | string
  | {
      before: string;
      after: string;
      replacementCount: number;
      diff: ReturnType<typeof createUnifiedDiff>;
      beforeHash: string;
    }
> {
  try {
    const workspace = getToolWorkspaceHost();
    const metadata = await workspace.stat(args.path);
    if (metadata.size > MAX_MUTATION_FILE_BYTES) {
      return `Error editing file '${args.path}': files larger than 16 MiB are not supported`;
    }
    const content = await workspace.readFile(args.path);
    if (bufferLooksBinary(content)) {
      return `Error editing file '${args.path}': binary files are not supported`;
    }

    const before = Buffer.from(content).toString("utf-8");
    const beforeHash = createHash("sha256").update(content).digest("hex");
    if (args.expectedBeforeHash && args.expectedBeforeHash !== beforeHash) {
      return `Error editing file '${args.path}': file changed after confirmation. Expected sha256 ${args.expectedBeforeHash}, got ${beforeHash}.`;
    }
    const exactRanges = findExactRanges(before, args.search);
    const ranges = exactRanges.length > 0 ? exactRanges : findLineEndingInsensitiveRanges(before, args.search);
    const replacementCount = ranges.length;
    if (replacementCount === 0) {
      return `Error editing file '${args.path}': search text not found`;
    }
    if (replacementCount > 1 && !args.replaceAll) {
      return `Error editing file '${args.path}': search text matched ${replacementCount} times. Set replaceAll to true to replace every match.`;
    }

    const replacement = normalizeReplacementLineEndings(args.replace, before);
    const selectedRanges = args.replaceAll ? ranges : ranges.slice(0, 1);
    const after = replaceRanges(before, selectedRanges, replacement);
    const diff = createUnifiedDiff({ filePath: args.path, before, after });

    if (options.showDiffPreview) {
      try {
        await workspace.prepareFileDiff?.(args.path, before, after);
      } catch {
      }
    }

    return {
      before,
      after,
      replacementCount: args.replaceAll ? replacementCount : 1,
      diff,
      beforeHash,
    };
  } catch (err: unknown) {
    return `Error editing file '${args.path}': ${getErrorMessage(err)}`;
  }
}

function parseEditFileArgs(args: Record<string, unknown>): EditFileArgs | string {
  const filePath = args.path;
  const search = args.search;
  const replace = args.replace;
  const replaceAll = args.replaceAll ?? false;
  const expectedBeforeHash = typeof args.expectedBeforeHash === "string" ? args.expectedBeforeHash : undefined;

  if (typeof filePath !== "string" || filePath.trim() === "") {
    return "Error: path parameter is required";
  }
  if (typeof search !== "string" || search.length === 0) {
    return "Error: search parameter is required and cannot be empty";
  }
  if (typeof replace !== "string") {
    return "Error: replace parameter is required";
  }
  if (typeof replaceAll !== "boolean") {
    return "Error: replaceAll parameter must be a boolean when provided";
  }

  return {
    path: filePath,
    search,
    replace,
    replaceAll,
    expectedBeforeHash,
  };
}

function findExactRanges(content: string, search: string): TextRange[] {
  const ranges: TextRange[] = [];
  let offset = 0;
  while (true) {
    const nextIndex = content.indexOf(search, offset);
    if (nextIndex === -1) {
      return ranges;
    }
    ranges.push({ start: nextIndex, end: nextIndex + search.length });
    offset = nextIndex + search.length;
  }
}

function replaceRanges(content: string, ranges: readonly TextRange[], replacement: string): string {
  let result = content;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index]!;
    result = `${result.slice(0, range.start)}${replacement}${result.slice(range.end)}`;
  }
  return result;
}

export const editFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "edit_file",
    description:
      "Edit an existing text file by replacing exact search text. Line endings are matched and preserved automatically; never inspect or adapt LF/CRLF before using this tool. Fails when the search text is missing or matches multiple times unless replaceAll is true.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path. Use an absolute path only for explicitly requested external access.",
        },
        search: {
          type: "string",
          description: "Exact text to find. Must be non-empty. Use normal newlines; matching is line-ending-insensitive.",
        },
        replace: {
          type: "string",
          description: "Replacement text. Its newlines are normalized to the file's existing style.",
        },
        replaceAll: {
          type: "boolean",
          description: "Replace every occurrence. Required when search text appears more than once.",
        },
        expectedBeforeHash: {
          type: "string",
          description: "Optional sha256 used to reject the edit if the file changed after preview.",
        },
      },
      required: ["path", "search", "replace"],
      additionalProperties: false,
    },
  },
};

export const editFileHandler: RegisteredTool["handler"] = handleEditFile;
export const editFileHandlerForced: RegisteredTool["handler"] = handleEditFileForced;

export const editFileMetadata: ToolMetadata = {
  dangerLevel: "caution",
  warningMessage: "This edits an existing workspace file.",
  requiresConfirmation: true,
};

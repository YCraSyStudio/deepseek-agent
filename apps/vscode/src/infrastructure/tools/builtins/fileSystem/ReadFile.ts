import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import { getToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { getErrorMessage } from "@/shared/utils/Errors";
import { bufferLooksBinary, createStructuredResult, toTextPreview } from "./StructuredResult";
import { splitSourceLines } from "./DocumentSymbols";
import { createHash } from "crypto";

const MAX_READ_PREVIEW_BYTES = 128 * 1024;
const MAX_RANGE_LINES = 600;
const MAX_RANGE_CHARS = 48 * 1024;
const MAX_RANGE_FILE_BYTES = 8 * 1024 * 1024;

interface LineRange {
  offset: number;
  limit?: number;
}

async function handleReadFile(args: Record<string, unknown>): Promise<string> {
  const filePath = args.path as string;
  if (!filePath) {
    return "Error: path parameter is required";
  }
  const range = parseLineRange(args);
  if (typeof range === "string") {
    return range;
  }

  try {
    const workspace = getToolWorkspaceHost();
    if (range) {
      return await readLineRange(workspace, filePath, range);
    }
    const preview = workspace.readFilePreview
      ? await workspace.readFilePreview(filePath, MAX_READ_PREVIEW_BYTES)
      : undefined;
    const content = preview
      ? Buffer.concat([Buffer.from(preview.head), ...(preview.tail ? [Buffer.from("\n...[middle omitted]...\n"), Buffer.from(preview.tail)] : [])])
      : await workspace.readFile(filePath);
    if (bufferLooksBinary(content)) {
      return createStructuredResult("file", {
        path: filePath,
        binary: true,
        size: content.byteLength,
        content: "",
      });
    }

    const textPreview = toTextPreview(content);
    const complete = !preview || preview.size <= MAX_READ_PREVIEW_BYTES;
    return createStructuredResult("file", {
      path: filePath,
      binary: false,
      size: preview?.size ?? content.byteLength,
      previewSize: Buffer.byteLength(textPreview.content, "utf-8"),
      truncated: textPreview.truncated || !complete,
      ...(complete ? { sha256: createHash("sha256").update(content).digest("hex") } : {}),
      content: textPreview.content,
    });
  } catch (err: unknown) {
    return `Error reading file '${filePath}': ${getErrorMessage(err)}`;
  }
}

async function readLineRange(workspace: ToolWorkspaceHost, filePath: string, range: LineRange): Promise<string> {
  const content = await workspace.readFile(filePath);
  if (bufferLooksBinary(content)) {
    return createStructuredResult("file", {
      path: filePath,
      binary: true,
      size: content.byteLength,
      content: "",
    });
  }
  if (content.byteLength > MAX_RANGE_FILE_BYTES) {
    return `Error: '${filePath}' is ${content.byteLength} bytes, which is too large to read as a line range. Use search_content to locate the lines instead.`;
  }

  const lines = splitSourceLines(Buffer.from(content).toString("utf8"));
  const startIndex = range.offset - 1;
  if (startIndex >= lines.length) {
    return `Error: offset ${range.offset} is past the end of '${filePath}', which has ${lines.length} lines.`;
  }

  const requestedEnd = Math.min(startIndex + (range.limit ?? MAX_RANGE_LINES), lines.length);
  const selected: string[] = [];
  let characters = 0;
  let clipped = false;
  for (let index = startIndex; index < requestedEnd; index += 1) {
    const line = lines[index]!;
    if (characters > 0 && characters + line.length + 1 > MAX_RANGE_CHARS) {
      clipped = true;
      break;
    }
    selected.push(line);
    characters += line.length + 1;
  }

  let text = selected.join("\n");
  if (text.length > MAX_RANGE_CHARS) {
    text = text.slice(0, MAX_RANGE_CHARS);
    clipped = true;
  }
  const endLine = startIndex + selected.length;

  return createStructuredResult("file", {
    path: filePath,
    binary: false,
    size: content.byteLength,
    totalLines: lines.length,
    startLine: range.offset,
    endLine,
    hasMore: endLine < lines.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    ...(clipped ? { truncated: true } : {}),
    content: text,
  });
}

function parseLineRange(args: Record<string, unknown>): LineRange | string | undefined {
  if (args.offset === undefined && args.limit === undefined) {
    return undefined;
  }
  const offset = toLineCount(args.offset);
  const limit = toLineCount(args.limit);
  if (args.offset !== undefined && offset === undefined) {
    return "Error: offset must be a positive integer, where 1 is the first line";
  }
  if (args.limit !== undefined && limit === undefined) {
    return "Error: limit must be a positive integer";
  }
  if (limit !== undefined && limit > MAX_RANGE_LINES) {
    return `Error: limit must not exceed ${MAX_RANGE_LINES} lines`;
  }
  return { offset: offset ?? 1, ...(limit !== undefined ? { limit } : {}) };
}

function toLineCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export const readFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read the contents of a file in the current project. The path is relative to the workspace root. Prefer read_func when the target is a named declaration, and a range for what the editor cannot name: find the text with search_content and read only the lines it reports. Read a whole file only for context that spans declarations. Use offset and limit to read a line range.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path, for example src/Main.ts. Use an absolute path only when the user explicitly requests access outside the workspace and the active permission mode allows it.",
        },
        offset: {
          type: "integer",
          description: "Optional 1-based line number to start reading from. Returns that line and the lines after it, up to limit.",
        },
        limit: {
          type: "integer",
          description: `Optional maximum number of lines to return, at most ${MAX_RANGE_LINES}. Defaults to ${MAX_RANGE_LINES} when offset is given without it.`,
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

export const readFileHandler: RegisteredTool["handler"] = handleReadFile;

export const readFileMetadata: ToolMetadata = {
  dangerLevel: "safe",
  requiresConfirmation: false,
};

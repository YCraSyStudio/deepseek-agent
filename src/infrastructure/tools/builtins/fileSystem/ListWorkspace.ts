import * as path from "node:path";
import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolHandlerContext, ToolMetadata } from "@/application/tools/Types";
import {
  getToolWorkspaceHost,
  type ToolWorkspaceEntryType,
  type ToolWorkspaceHost,
} from "@/infrastructure/tools/ToolWorkspace";

const MAX_TREE_LINES = 400;
const MAX_TREE_BYTES = 48 * 1024;
const MAX_DIRECTORY_READS = 300;
const MAX_ROOT_CHILDREN = 60;
const MAX_DIRECTORY_CHILDREN = 25;
const MAX_SUBTREE_LINES = 60;
const MAX_DEPTH = 6;
const INDENT = "  ";
const COLLAPSED = "...";

interface TraversalState {
  reads: number;
  overflowed: boolean;
  truncated: boolean;
  collapsed: number;
  files: number;
  directories: number;
  rootReadError?: string;
}

interface WorkspaceScope {
  path: string;
  label: string;
}

async function handleListWorkspace(args: Record<string, unknown>, context?: ToolHandlerContext): Promise<string> {
  const scope = normalizeScope(args.path);
  const workspace = getToolWorkspaceHost();
  if (!workspace.getRootPath() && !workspace.getWorkspaceId?.()) {
    throw new Error("No workspace folder open");
  }
  if (typeof workspace.readDirectory !== "function") {
    throw new Error("Workspace tree listing is unavailable in this environment");
  }

  const state: TraversalState = {
    reads: 0,
    overflowed: false,
    truncated: false,
    collapsed: 0,
    files: 0,
    directories: 0,
  };
  const rootLines = await renderDirectory(workspace, scope.path, 0, MAX_TREE_LINES, state, context);
  if (rootLines === null) {
    if (context?.signal?.aborted) {
      throw createAbortError();
    }
    throw new Error(`Cannot list workspace path "${scope.label}": ${state.rootReadError ?? "unreadable path"}`);
  }

  const header = `Workspace tree for "${scope.label}" (${state.files} files, ${state.directories} folders). Hidden entries are included; a folder shown as "${COLLAPSED}" holds more entries than this summary lists:`;
  const notes: string[] = [];
  if (state.collapsed > 0) {
    notes.push(`...[${state.collapsed} folder${state.collapsed === 1 ? " is" : "s are"} summarized as "${COLLAPSED}". Use list_directory on one to open it.]`);
  }
  if (state.truncated) {
    notes.push(`...[tree truncated after ${MAX_TREE_LINES} entries. Pass the path argument to scope it to one subtree.]`);
  }
  if (state.overflowed) {
    notes.push(`...[stopped after reading ${MAX_DIRECTORY_READS} folders. Pass the path argument to scope the tree.]`);
  }
  if (state.files + state.directories === 0) {
    notes.push("...[no entries found. Verify the path with list_directory.]");
  }

  return boundOutput([header, ...rootLines, ...notes]);
}

function normalizeScope(value: unknown): WorkspaceScope {
  if (value === undefined || value === null) {
    return { path: ".", label: "." };
  }
  if (typeof value !== "string") {
    throw new Error("path must be a string");
  }

  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!trimmed || trimmed === ".") {
    return { path: ".", label: "." };
  }
  if (trimmed.includes("\0")) {
    throw new Error("path contains an invalid null byte");
  }
  if (trimmed.split("/").includes("..")) {
    throw new Error("path must stay inside the workspace");
  }
  if (trimmed.startsWith("/") || path.win32.isAbsolute(trimmed) || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
    throw new Error("path must be relative to the selected workspace");
  }
  return { path: trimmed, label: trimmed };
}

async function renderDirectory(
  workspace: ToolWorkspaceHost,
  dirPath: string,
  depth: number,
  lineBudget: number,
  state: TraversalState,
  context?: ToolHandlerContext,
): Promise<string[] | null> {
  if (state.overflowed || depth > MAX_DEPTH || lineBudget < 2) {
    return null;
  }
  if (state.reads >= MAX_DIRECTORY_READS) {
    state.overflowed = true;
    return null;
  }
  state.reads += 1;
  if (context?.signal?.aborted) {
    throw createAbortError();
  }

  let entries: Array<[string, ToolWorkspaceEntryType]>;
  try {
    entries = await workspace.readDirectory(dirPath);
  } catch (error: unknown) {
    if (depth === 0) {
      state.rootReadError = error instanceof Error ? error.message : String(error);
    }
    return null;
  }
  if (context?.signal?.aborted) {
    throw createAbortError();
  }

  const isRoot = depth === 0;
  const childLimit = isRoot ? MAX_ROOT_CHILDREN : MAX_DIRECTORY_CHILDREN;
  if (!isRoot && entries.length > childLimit) {
    return null;
  }
  const visible = sortEntries(entries).slice(0, childLimit);
  if (visible.length < entries.length) {
    state.truncated = true;
  }

  const prefix = INDENT.repeat(depth);
  const lines: string[] = [];
  let used = 0;

  for (const [name, type] of visible) {
    if (used + 1 > lineBudget) {
      if (!isRoot) {
        return null;
      }
      state.truncated = true;
      break;
    }

    if (type !== "directory") {
      lines.push(`${prefix}${name}`);
      used += 1;
      state.files += 1;
      continue;
    }

    lines.push(`${prefix}${name}/`);
    used += 1;
    const counters = { files: state.files, directories: state.directories, collapsed: state.collapsed };
    const child = await renderDirectory(
      workspace,
      joinPath(dirPath, name),
      depth + 1,
      Math.min(MAX_SUBTREE_LINES, lineBudget - used),
      state,
      context,
    );
    if (child) {
      lines.push(...child);
      used += child.length;
      state.directories += 1;
      continue;
    }

    state.files = counters.files;
    state.directories = counters.directories;
    state.collapsed = counters.collapsed;
    if (used + 1 > lineBudget) {
      if (!isRoot) {
        return null;
      }
      state.truncated = true;
      break;
    }
    lines.push(`${INDENT.repeat(depth + 1)}${COLLAPSED}`);
    used += 1;
    state.directories += 1;
    state.collapsed += 1;
  }

  return lines;
}

function joinPath(dirPath: string, name: string): string {
  return dirPath === "." ? name : `${dirPath}/${name}`;
}

function sortEntries(entries: ReadonlyArray<[string, ToolWorkspaceEntryType]>): Array<[string, ToolWorkspaceEntryType]> {
  return [...entries].sort(([leftName, leftType], [rightName, rightType]) => {
    const leftIsDirectory = leftType === "directory" ? 0 : 1;
    const rightIsDirectory = rightType === "directory" ? 0 : 1;
    if (leftIsDirectory !== rightIsDirectory) {
      return leftIsDirectory - rightIsDirectory;
    }
    return leftName.localeCompare(rightName);
  });
}

function boundOutput(lines: string[]): string {
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (kept.length > 0 && bytes + lineBytes > MAX_TREE_BYTES) {
      kept.push(`...[output truncated after ${Math.round(MAX_TREE_BYTES / 1024)} KiB.]`);
      break;
    }
    kept.push(line);
    bytes += lineBytes;
  }
  return kept.join("\n");
}

function createAbortError(): Error {
  const error = new Error("Workspace tree listing cancelled");
  error.name = "AbortError";
  return error;
}

export const listWorkspaceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_workspace",
    description:
      "List the whole project as one indented tree in a single call. Prefer this once when starting a task instead of repeated list_directory calls. Hidden entries are included, and folders with too much content are summarized as \"...\"; call list_directory on one of those to open it. Use the path argument to scope the tree to a subfolder.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional workspace-relative subfolder to scope the tree. Defaults to the whole workspace.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const listWorkspaceHandler: RegisteredTool["handler"] = handleListWorkspace;

export const listWorkspaceMetadata: ToolMetadata = {
  dangerLevel: "safe",
  requiresConfirmation: false,
};

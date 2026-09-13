import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import type { ToolHostDocumentSymbol } from "@/application/ports";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { getErrorMessage } from "@/shared/utils/Errors";
import { createHash } from "crypto";
import { bufferLooksBinary, createStructuredResult } from "./StructuredResult";
import {
  buildSymbolTree,
  flattenSymbols,
  resolveSymbol,
  splitSourceLines,
  type CodeSymbol,
} from "./DocumentSymbols";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUESTS = 16;
const MAX_NAME_LENGTH = 200;
const MAX_SYMBOL_CHARS = 16 * 1024;
const MAX_TOTAL_CODE_CHARS = 48 * 1024;
const MAX_AVAILABLE_NAMES = 40;
const MAX_AMBIGUOUS_CANDIDATES = 8;
const MAX_OUTLINE_MEMBERS = 60;
const SYMBOL_PROVIDER_RETRY_DELAYS_MS = [250, 750];
const EVERYTHING = "*";

interface MatchedEntry {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature: string;
  code?: string;
  codeTruncated?: boolean;
  members?: Array<{ name: string; kind: string; startLine: number; endLine: number }>;
  membersTruncated?: boolean;
  note?: string;
}

interface AmbiguousEntry {
  name: string;
  candidates: string[];
}

async function handleReadFunction(args: Record<string, unknown>): Promise<string> {
  const filePath = typeof args.path === "string" ? args.path.trim() : "";
  if (!filePath) {
    return "Error: path parameter is required";
  }
  const requested = parseRequestedNames(args.names);
  if (typeof requested === "string") {
    return requested;
  }
  const outline = args.mode === "outline";

  try {
    const workspace = getToolWorkspaceHost();
    const readSymbols = workspace.readDocumentSymbols?.bind(workspace);
    if (!readSymbols) {
      return "Error: read_func requires the editor language providers, which are unavailable here. Find the name with search_content and read its lines with read_file offset and limit instead.";
    }
    const content = await workspace.readFile(filePath);
    if (bufferLooksBinary(content)) {
      return `Error: '${filePath}' is a binary file`;
    }
    if (content.byteLength > MAX_FILE_BYTES) {
      return `Error: '${filePath}' is ${content.byteLength} bytes, which is too large for read_func. Use search_content to locate the relevant lines instead.`;
    }

    const lines = splitSourceLines(Buffer.from(content).toString("utf8"));
    const rawSymbols = await readDocumentSymbolsWithRetry(readSymbols, filePath);
    const tree = buildSymbolTree(rawSymbols, lines);
    if (tree.length === 0) {
      return `Error: the editor reported no symbols for '${filePath}'. Retry once if the language service was still starting, or find the name with search_content and read its lines with read_file offset and limit.`;
    }
    const symbols = flattenSymbols(tree);
    const matched: MatchedEntry[] = [];
    const missing: string[] = [];
    const ambiguous: AmbiguousEntry[] = [];
    const targets: CodeSymbol[] = [];
    let codeCharacters = 0;
    let truncated = false;

    for (const name of requested) {
      if (name === EVERYTHING) {
        targets.push(...tree);
        continue;
      }
      const selected = resolveSymbol(symbols, name);
      if (selected.length === 0) {
        missing.push(name);
        continue;
      }
      if (selected.length > 1) {
        ambiguous.push({
          name,
          candidates: selected.slice(0, MAX_AMBIGUOUS_CANDIDATES).map((symbol) => symbol.qualifiedName),
        });
        truncated ||= selected.length > MAX_AMBIGUOUS_CANDIDATES;
        continue;
      }
      targets.push(selected[0]!);
    }

    for (const symbol of targets) {
      const entry: MatchedEntry = {
        name: symbol.qualifiedName,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        signature: symbol.signature,
      };

      if (outline) {
        if (symbol.isContainer) {
          entry.members = symbol.members.slice(0, MAX_OUTLINE_MEMBERS).map((member) => ({
            name: member.name,
            kind: member.kind,
            startLine: member.startLine,
            endLine: member.endLine,
          }));
          entry.membersTruncated ||= symbol.members.length > MAX_OUTLINE_MEMBERS;
        }
        matched.push(entry);
        continue;
      }

      const code = symbolCode(lines, symbol);
      if (codeCharacters > 0 && codeCharacters + code.length > MAX_TOTAL_CODE_CHARS) {
        entry.note = "Body omitted: this call already returned its content budget. Request this symbol in a separate read_func call.";
        truncated = true;
      } else {
        entry.code = code.length > MAX_SYMBOL_CHARS ? code.slice(0, MAX_SYMBOL_CHARS) : code;
        entry.codeTruncated ||= code.length > MAX_SYMBOL_CHARS;
        codeCharacters += entry.code.length;
        truncated ||= entry.codeTruncated === true;
      }
      matched.push(entry);
    }

    return createStructuredResult("functions", {
      path: filePath,
      size: content.byteLength,
      totalLines: lines.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      mode: outline ? "outline" : "body",
      matched,
      ...(ambiguous.length > 0 ? { ambiguous } : {}),
      ...(missing.length > 0 ? { missing, availableNames: symbols.slice(0, MAX_AVAILABLE_NAMES).map((symbol) => symbol.qualifiedName) } : {}),
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err: unknown) {
    return `Error reading functions from '${filePath}': ${getErrorMessage(err)}`;
  }
}

async function readDocumentSymbolsWithRetry(
  readSymbols: (filePath: string) => Promise<ToolHostDocumentSymbol[]>,
  filePath: string,
): Promise<ToolHostDocumentSymbol[]> {
  let symbols = await readSymbols(filePath);
  for (const delay of SYMBOL_PROVIDER_RETRY_DELAYS_MS) {
    if (symbols.length > 0) {
      return symbols;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    symbols = await readSymbols(filePath);
  }
  return symbols;
}

function symbolCode(lines: readonly string[], symbol: CodeSymbol): string {
  const selected = lines.slice(symbol.startLine - 1, Math.min(symbol.endLine, lines.length));
  while (selected.length > 0 && selected[selected.length - 1] === "") {
    selected.pop();
  }
  return selected.join("\n");
}

function parseRequestedNames(value: unknown): string[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "Error: names parameter must be a non-empty array of symbol names";
  }
  if (value.length > MAX_REQUESTS) {
    return `Error: names must not contain more than ${MAX_REQUESTS} entries`;
  }
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      return "Error: every entry of names must be a non-empty string";
    }
    if (entry.length > MAX_NAME_LENGTH) {
      return `Error: every name must not exceed ${MAX_NAME_LENGTH} characters`;
    }
    names.push(entry.trim());
  }
  return names;
}

export const readFunctionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_func",
    description:
      "Read only the named functions, methods, or types of one source file instead of its whole content: this is the preferred read whenever a declaration is the target. Names come from the editor's symbol provider and may be chained with the enclosing declaration, for example \"run\", \"ToolCallCycle.run\", or \"Widget.render\"; use [\"*\"] for every top-level declaration. Members of an object literal are not declarations and cannot be named, so an unresolved name is reached with search_content plus a read_file line range (offset, limit). Each match returns its exact source, its line range, and the file sha256 for a later edit. Use mode \"outline\" to inspect structure without bodies.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path, for example src/Chat.ts. Use an absolute path only when the user explicitly requests access outside the workspace and the active permission mode allows it.",
        },
        names: {
          type: "array",
          items: { type: "string" },
          description: "Symbol names to return, either bare or chained through their containers. Prefer one call with several names over one call per symbol.",
        },
        mode: {
          type: "string",
          enum: ["body", "outline"],
          description: "body (default) returns the source of each match; outline returns only signatures, line ranges, and the members of a class or interface.",
        },
      },
      required: ["path", "names"],
      additionalProperties: false,
    },
  },
};

export const readFunctionHandler: RegisteredTool["handler"] = handleReadFunction;

export const readFunctionMetadata: ToolMetadata = {
  dangerLevel: "safe",
  requiresConfirmation: false,
};

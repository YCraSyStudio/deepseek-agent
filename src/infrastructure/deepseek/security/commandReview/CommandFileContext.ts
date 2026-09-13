import * as path from "node:path";
import { getToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { detectScriptInvocation } from "@/infrastructure/tools/safety/CommandFacts";

const MAX_FILES = 3;
const MAX_PREVIEW_BYTES = 4_096;

export interface CommandFileContext {
  path: string;
  size: number;
  truncated: boolean;
  content?: string;
}

export async function collectCommandFileContext(
  command: string,
  cwd: string | undefined,
  workspaceRoot: string | undefined,
): Promise<CommandFileContext[]> {
  if (!cwd || !workspaceRoot) {
    return [];
  }

  let workspace;
  try {
    workspace = getToolWorkspaceHost();
  } catch {
    return [];
  }

  const candidates = extractExplicitFileOperands(command);
  const contexts: CommandFileContext[] = [];
  for (const candidate of candidates) {
    if (contexts.length >= MAX_FILES) {
      break;
    }
    const relativePath = resolveCandidate(candidate, cwd, workspaceRoot);
    if (!relativePath) {
      continue;
    }
    try {
      const metadata = await workspace.stat(relativePath);
      if (metadata.type !== "file") {
        continue;
      }
      const preview = workspace.readFilePreview
        ? await workspace.readFilePreview(relativePath, MAX_PREVIEW_BYTES)
        : metadata.size <= MAX_PREVIEW_BYTES ? {
            head: (await workspace.readFile(relativePath)).slice(0, MAX_PREVIEW_BYTES),
            size: metadata.size,
          } : { head: new Uint8Array(), size: metadata.size };
      const content = preview.head.byteLength > 0
        ? decodeTextPreview(preview.head, preview.tail)
        : undefined;
      contexts.push({
        path: relativePath,
        size: preview.size,
        truncated: preview.size > preview.head.byteLength + (preview.tail?.byteLength ?? 0),
        ...(content === undefined ? {} : { content }),
      });
    } catch {
    }
  }
  return contexts;
}

function extractExplicitFileOperands(command: string): string[] {
  const candidates: string[] = [];
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length < 2) {
      continue;
    }
    const program = path.win32.basename(tokens[0]!).replace(/\.exe$/i, "").toLowerCase();
    if (new Set(["del", "erase", "rm", "unlink", "rmdir"]).has(program)) {
      candidates.push(...tokens.slice(1).filter((token) => !isOption(program, token)));
    } else if (new Set([
      "copy",
      "cp",
      "move",
      "mv",
      "ren",
      "rename",
      "copy-item",
      "move-item",
      "rename-item",
      "remove-item",
    ]).has(program)) {
      candidates.push(...extractMutationOperands(tokens.slice(1)));
    } else {
      const script = detectScriptInvocation(tokens);
      if (script) {
        candidates.push(script.path);
      }
    }
  }
  return [...new Set(candidates.filter(isExplicitPath))];
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote) {
      current += character;
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = "";
      while (command[index + 1] === character) {
        index += 1;
      }
      continue;
    }
    current += character;
  }
  if (current.trim()) {
    segments.push(current.trim());
  }
  return segments;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const character of segment) {
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function extractMutationOperands(tokens: string[]): string[] {
  const operands: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const lower = token.toLowerCase();
    if (lower === "-path" || lower === "-literalpath" || lower === "-destination" || lower === "-newname") {
      const value = tokens[++index];
      if (value) {
        operands.push(value);
      }
    } else if (!token.startsWith("-") && !/^\/[a-z]+$/i.test(token)) {
      operands.push(token);
    }
  }
  return operands;
}

function isOption(program: string, token: string): boolean {
  return token.startsWith("-") || ((program === "del" || program === "erase" || program === "rmdir") &&
    /^\/[a-z]+$/i.test(token));
}

function isExplicitPath(candidate: string): boolean {
  return !!candidate &&
    !candidate.split(/[\\/]/).includes("..") &&
    !/[*?[\]{}%$!`]/.test(candidate) &&
    !/^(?:~|[a-zA-Z][\w+.-]*:\/\/)/.test(candidate);
}

function resolveCandidate(candidate: string, cwd: string, workspaceRoot: string): string | undefined {
  const pathApi = path.win32.isAbsolute(workspaceRoot) ? path.win32 : path.posix;
  const absolute = pathApi.isAbsolute(candidate)
    ? pathApi.resolve(candidate)
    : pathApi.resolve(cwd, candidate);
  const relative = pathApi.relative(pathApi.resolve(workspaceRoot), absolute);
  if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    return undefined;
  }
  return (relative || ".").replace(/\\/g, "/");
}

function decodeTextPreview(head: Uint8Array, tail?: Uint8Array): string | undefined {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const start = decoder.decode(head);
    if (start.includes("\0")) {
      return undefined;
    }
    if (!tail) {
      return start;
    }
    const end = decoder.decode(tail);
    return end.includes("\0") ? undefined : `${start}\n… omitted …\n${end}`;
  } catch {
    return undefined;
  }
}

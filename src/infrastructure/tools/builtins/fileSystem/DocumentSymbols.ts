import type { ToolHostDocumentSymbol } from "@/application/ports";

export type { ToolHostDocumentSymbol } from "@/application/ports";

export interface CodeSymbol {
  name: string;
  qualifiedName: string;
  container?: string;
  kind: string;
  isContainer: boolean;
  startLine: number;
  endLine: number;
  signature: string;
  members: CodeSymbol[];
}

const DECLARATION_KINDS = new Set([
  "variable",
  "constant",
  "function",
  "method",
  "constructor",
  "class",
  "interface",
  "enum",
  "struct",
  "trait",
  "module",
  "namespace",
  "package",
  "object",
  "event",
  "operator",
  "accessor",
]);

const CONTAINER_KINDS = new Set([
  "class",
  "interface",
  "enum",
  "struct",
  "trait",
  "module",
  "namespace",
  "package",
  "object",
]);

export function buildSymbolTree(roots: readonly ToolHostDocumentSymbol[], lines: readonly string[]): CodeSymbol[] {
  return buildLevel(roots, lines).map((symbol) => withContainer(symbol));
}

export function flattenSymbols(tree: readonly CodeSymbol[]): CodeSymbol[] {
  return tree.flatMap((symbol) => [symbol, ...flattenSymbols(symbol.members)]);
}

export function resolveSymbol(symbols: readonly CodeSymbol[], requested: string): CodeSymbol[] {
  const query = requested.replace(/\s+/g, "");
  const segments = query.split(/[.:#>/\\]+/).filter(Boolean);
  const tail = segments[segments.length - 1];
  if (!query || !tail) {
    return [];
  }

  const exact = symbols.filter((symbol) => symbol.qualifiedName === query);
  if (exact.length > 0) {
    return exact;
  }
  if (segments.length > 1) {
    const chain = segments.join(".");
    const suffix = symbols.filter((symbol) => symbol.qualifiedName.endsWith(`.${chain}`));
    if (suffix.length > 0) {
      return suffix;
    }
  }
  const byName = symbols.filter((symbol) => symbol.name === tail);
  return byName.length > 0 ? byName : symbols.filter((symbol) => symbol.name.toLowerCase() === tail.toLowerCase());
}

export function splitSourceLines(content: string): string[] {
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return source.replace(/\r\n?/g, "\n").split("\n");
}

function buildLevel(raws: readonly ToolHostDocumentSymbol[], lines: readonly string[]): CodeSymbol[] {
  const result: CodeSymbol[] = [];
  for (const raw of raws) {
    const kind = raw.kind.toLowerCase();
    const members = buildLevel(raw.children, lines);
    if (!DECLARATION_KINDS.has(kind)) {
      result.push(...members);
      continue;
    }
    result.push({ ...createSymbol(raw, lines, kind), members });
  }
  return result;
}

function createSymbol(raw: ToolHostDocumentSymbol, lines: readonly string[], kind: string): CodeSymbol {
  return {
    name: raw.name,
    qualifiedName: raw.name,
    kind,
    isContainer: CONTAINER_KINDS.has(kind),
    startLine: raw.startLine + 1,
    endLine: raw.endLine + 1,
    signature: buildSignature(lines, raw.startLine, raw.nameLine),
    members: [],
  };
}

function withContainer(symbol: CodeSymbol, container?: string): CodeSymbol {
  const qualifiedName = container ? `${container}.${symbol.qualifiedName}` : symbol.qualifiedName;
  return {
    ...symbol,
    ...(container ? { container } : {}),
    qualifiedName,
    members: symbol.members.map((member) => withContainer(member, qualifiedName)),
  };
}

function buildSignature(lines: readonly string[], startLine: number, nameLine: number): string {
  const lastLine = Math.min(Math.max(nameLine, startLine), startLine + 3);
  const text = lines
    .slice(startLine, lastLine + 1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

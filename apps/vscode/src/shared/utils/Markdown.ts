export function normalizeAssistantMarkdown(content: string): string {
  const unwrapped = unwrapXmlResponse(content);
  return transformOutsideCodeFences(unwrapped, (text) => normalizeGfmTables(unescapeMarkdownSyntax(text)));
}

function transformOutsideCodeFences(content: string, transform: (text: string) => string): string {
  return content
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith("```") ? part : transform(part)))
    .join("");
}

function unwrapXmlResponse(content: string): string {
  let text = content.trim();
  const wrapperTags = new Set(["answer", "response", "final", "content", "message", "summary", "result"]);

  for (let i = 0; i < 3; i += 1) {
    const match = text.match(/^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/\1>$/);
    if (!match || !wrapperTags.has(match[1].toLowerCase())) {
      break;
    }
    text = match[2].trim();
  }

  return text;
}

function unescapeMarkdownSyntax(content: string): string {
  return content.replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1");
}

function normalizeGfmTables(content: string): string {
  const lines = content.split("\n");
  const normalized: string[] = [];
  let inTable = false;
  let tableHasSeparator = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const cells = getTableCells(line);
    const nextLine = lines[index + 1];
    const nextCells = nextLine === undefined ? [] : getTableCells(nextLine);

    if (cells.length < 2) {
      normalized.push(line);
      inTable = false;
      tableHasSeparator = false;
      continue;
    }

    if (isSeparatorRow(cells)) {
      if (inTable && !tableHasSeparator) {
        normalized.push(formatSeparatorRow(cells.length));
        tableHasSeparator = true;
      }
      continue;
    }

    if (nextLine !== undefined) {
      if (isSeparatorRow(nextCells)) {
        normalized.push(formatTableRow(cells));
        if (inTable) {
          tableHasSeparator = true;
        } else {
          inTable = true;
          tableHasSeparator = false;
        }
        continue;
      }

      if (!inTable && nextCells.length >= 2 && !isSeparatorRow(nextCells) && !isLikelyNonTableLine(nextLine)) {
        normalized.push(formatTableRow(cells));
        normalized.push(formatSeparatorRow(cells.length));
        inTable = true;
        tableHasSeparator = true;
        continue;
      }
    }

    normalized.push(inTable ? formatTableRow(cells) : line);
  }

  return normalized.join("\n");
}

function getTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return [];
  }

  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isLikelyNonTableLine(line: string): boolean {
  const trimmed = line.trim();
  return !trimmed || /^#{1,6}\s/.test(trimmed) || /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function formatSeparatorRow(cellCount: number): string {
  return `| ${Array.from({ length: cellCount }, () => "---").join(" | ")} |`;
}

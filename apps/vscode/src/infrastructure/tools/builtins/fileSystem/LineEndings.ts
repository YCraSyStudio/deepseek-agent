export type LineEnding = "\r\n" | "\n" | "\r";

export interface TextLine {
  text: string;
  ending: "" | LineEnding;
}

export interface TextRange {
  start: number;
  end: number;
}

export function findLineEndingInsensitiveRanges(content: string, search: string): TextRange[] {
  const normalizedContent = normalizeWithRawOffsets(content);
  const normalizedSearch = normalizeLineEndings(search);
  if (!normalizedSearch) {
    return [];
  }

  const ranges: TextRange[] = [];
  let offset = 0;
  while (true) {
    const index = normalizedContent.text.indexOf(normalizedSearch, offset);
    if (index < 0) {
      return ranges;
    }
    ranges.push({
      start: normalizedContent.rawOffsets[index]!,
      end: normalizedContent.rawOffsets[index + normalizedSearch.length]!,
    });
    offset = index + normalizedSearch.length;
  }
}

export function normalizeReplacementLineEndings(value: string, content: string): string {
  const ending = getPredominantLineEnding(content);
  return normalizeLineEndings(value).replace(/\n/g, ending);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

export function splitTextLines(content: string): TextLine[] {
  if (!content) {
    return [];
  }

  const lines: TextLine[] = [];
  let start = 0;
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (character !== "\r" && character !== "\n") {
      index += 1;
      continue;
    }

    const ending: LineEnding = character === "\r" && content[index + 1] === "\n"
      ? "\r\n"
      : character;
    lines.push({ text: content.slice(start, index), ending });
    index += ending.length;
    start = index;
  }

  if (start < content.length) {
    lines.push({ text: content.slice(start), ending: "" });
  }
  return lines;
}

export function joinTextLines(lines: readonly TextLine[], options: { trailingLineEnding: boolean; fallback: LineEnding }): string {
  if (lines.length === 0) {
    return "";
  }

  return lines.map((line, index) => {
    if (index !== lines.length - 1) {
      return `${line.text}${line.ending || options.fallback}`;
    }
    return `${line.text}${options.trailingLineEnding ? line.ending || options.fallback : ""}`;
  }).join("");
}

export function getPredominantLineEnding(content: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  let first: LineEnding | undefined;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\r" && content[index + 1] === "\n") {
      crlf += 1;
      first ??= "\r\n";
      index += 1;
    } else if (content[index] === "\n") {
      lf += 1;
      first ??= "\n";
    } else if (content[index] === "\r") {
      cr += 1;
      first ??= "\r";
    }
  }

  const maximum = Math.max(crlf, lf, cr);
  if (maximum === 0) {
    return process.platform === "win32" ? "\r\n" : "\n";
  }
  if (first && ((first === "\r\n" && crlf === maximum) || (first === "\n" && lf === maximum) || (first === "\r" && cr === maximum))) {
    return first;
  }
  return crlf === maximum ? "\r\n" : lf === maximum ? "\n" : "\r";
}

export function hasTrailingLineEnding(content: string): boolean {
  return /(?:\r\n|\r|\n)$/.test(content);
}

function normalizeWithRawOffsets(value: string): { text: string; rawOffsets: number[] } {
  let text = "";
  const rawOffsets = [0];
  let index = 0;
  while (index < value.length) {
    if (value[index] === "\r") {
      text += "\n";
      index += value[index + 1] === "\n" ? 2 : 1;
    } else {
      text += value[index];
      index += 1;
    }
    rawOffsets.push(index);
  }
  return { text, rawOffsets };
}

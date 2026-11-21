const RESULT_VERSION = 1;
const MAX_TEXT_CHARS = 120_000;
const MAX_DIFF_LINES = 240;
const DIFF_CONTEXT_LINES = 3;
const MAX_LCS_CELLS = 1_000_000;

export const MAX_RECORDED_DIFF_LINES = 4_000;

export interface UnifiedDiffPreview {
  content: string;
  truncated: boolean;
  stats: {
    additions: number;
    deletions: number;
  };
}

export function createStructuredResult(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    toolResultVersion: RESULT_VERSION,
    type,
    ...payload,
  });
}

export function bufferLooksBinary(buffer: Uint8Array): boolean {
  const length = Math.min(buffer.byteLength, 4096);
  for (let index = 0; index < length; index++) {
    const byte = buffer[index];
    if (byte === 0) {
      return true;
    }
    if (byte < 8 || (byte > 13 && byte < 32)) {
      return true;
    }
  }
  return false;
}

export function toTextPreview(buffer: Uint8Array): { content: string; truncated: boolean } {
  const content = Buffer.from(buffer).toString("utf-8");
  if (content.length <= MAX_TEXT_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(0, MAX_TEXT_CHARS),
    truncated: true,
  };
}

export function createUnifiedDiff(options: { filePath: string; before: string; after: string }): UnifiedDiffPreview {
  const beforeLines = splitDiffLines(options.before);
  const afterLines = splitDiffLines(options.after);
  const operations = createDiffOperations(beforeLines, afterLines);
  const stats = operations.reduce(
    (acc, operation) => {
      if (operation.type === "add") {
        acc.additions += 1;
      }
      if (operation.type === "remove") {
        acc.deletions += 1;
      }
      return acc;
    },
    { additions: 0, deletions: 0 },
  );

  const diffLines = [`--- a/${options.filePath}`, `+++ b/${options.filePath}`];
  const hunks = buildDiffHunks(operations);
  for (const hunk of hunks) {
    diffLines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const operation of hunk.operations) {
      diffLines.push(`${getDiffPrefix(operation.type)}${operation.text}`);
      if (diffLines.length >= MAX_DIFF_LINES) {
        const omitted = Math.max(operations.length - diffLines.length, 0);
        diffLines.push(`... diff truncated (${omitted} more lines not shown)`);
        return { content: diffLines.join("\n"), truncated: true, stats };
      }
    }
  }

  return { content: diffLines.join("\n"), truncated: false, stats };
}

function splitDiffLines(content: string): string[] {
  return content.length === 0 ? [] : content.split("\n");
}

type DiffOperation = {
  type: "equal" | "add" | "remove";
  text: string;
  oldLine: number;
  newLine: number;
};

type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  operations: DiffOperation[];
};

type DiffOffsets = { oldOffset: number; newOffset: number };

function createDiffOperations(beforeLines: string[], afterLines: string[]): DiffOperation[] {
  let prefixLength = 0;
  while (prefixLength < beforeLines.length && prefixLength < afterLines.length && beforeLines[prefixLength] === afterLines[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength + prefixLength < beforeLines.length &&
    suffixLength + prefixLength < afterLines.length &&
    beforeLines[beforeLines.length - suffixLength - 1] === afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const beforeMiddle = beforeLines.slice(prefixLength, beforeLines.length - suffixLength);
  const afterMiddle = afterLines.slice(prefixLength, afterLines.length - suffixLength);
  const offsets = { oldOffset: prefixLength + 1, newOffset: prefixLength + 1 };
  const middleOperations =
    beforeMiddle.length * afterMiddle.length <= MAX_LCS_CELLS
      ? createLcsDiffOperations(beforeMiddle, afterMiddle, offsets)
      : createLinearDiffOperations(beforeMiddle, afterMiddle, offsets);

  return [
    ...beforeLines.slice(0, prefixLength).map((text, index) => createEqualOperation(text, index + 1, index + 1)),
    ...middleOperations,
    ...beforeLines
      .slice(beforeLines.length - suffixLength)
      .map((text, index) => createEqualOperation(text, beforeLines.length - suffixLength + index + 1, afterLines.length - suffixLength + index + 1)),
  ];
}

function createLcsDiffOperations(beforeLines: string[], afterLines: string[], offsets: DiffOffsets): DiffOperation[] {
  const table: number[][] = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0));

  for (let oldIndex = beforeLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = afterLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        beforeLines[oldIndex] === afterLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const operations: DiffOperation[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < beforeLines.length && newIndex < afterLines.length) {
    if (beforeLines[oldIndex] === afterLines[newIndex]) {
      operations.push(createEqualOperation(beforeLines[oldIndex], offsets.oldOffset + oldIndex, offsets.newOffset + newIndex));
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      operations.push({ type: "remove", text: beforeLines[oldIndex], oldLine: offsets.oldOffset + oldIndex, newLine: offsets.newOffset + newIndex });
      oldIndex += 1;
    } else {
      operations.push({ type: "add", text: afterLines[newIndex], oldLine: offsets.oldOffset + oldIndex, newLine: offsets.newOffset + newIndex });
      newIndex += 1;
    }
  }

  while (oldIndex < beforeLines.length) {
    operations.push({ type: "remove", text: beforeLines[oldIndex], oldLine: offsets.oldOffset + oldIndex, newLine: offsets.newOffset + newIndex });
    oldIndex += 1;
  }

  while (newIndex < afterLines.length) {
    operations.push({ type: "add", text: afterLines[newIndex], oldLine: offsets.oldOffset + oldIndex, newLine: offsets.newOffset + newIndex });
    newIndex += 1;
  }

  return operations;
}

function createLinearDiffOperations(beforeLines: string[], afterLines: string[], offsets: DiffOffsets): DiffOperation[] {
  return [
    ...beforeLines.map((text, index) => ({ type: "remove" as const, text, oldLine: offsets.oldOffset + index, newLine: offsets.newOffset })),
    ...afterLines.map((text, index) => ({
      type: "add" as const,
      text,
      oldLine: offsets.oldOffset + beforeLines.length,
      newLine: offsets.newOffset + index,
    })),
  ];
}

function createEqualOperation(text: string, oldLine: number, newLine: number): DiffOperation {
  return { type: "equal", text, oldLine, newLine };
}

function buildDiffHunks(operations: DiffOperation[]): DiffHunk[] {
  const changeIndexes = operations
    .map((operation, index) => (operation.type === "equal" ? -1 : index))
    .filter((index) => index >= 0);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const changeIndex of changeIndexes) {
    const start = Math.max(0, changeIndex - DIFF_CONTEXT_LINES);
    const end = Math.min(operations.length - 1, changeIndex + DIFF_CONTEXT_LINES);
    const previousRange = ranges[ranges.length - 1];
    if (previousRange && start <= previousRange.end + 1) {
      previousRange.end = Math.max(previousRange.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range) => {
    const hunkOperations = operations.slice(range.start, range.end + 1);
    const oldCount = hunkOperations.filter((operation) => operation.type !== "add").length;
    const newCount = hunkOperations.filter((operation) => operation.type !== "remove").length;
    const first = hunkOperations[0];
    return {
      oldStart: first.oldLine,
      oldCount,
      newStart: first.newLine,
      newCount,
      operations: hunkOperations,
    };
  });
}

function getDiffPrefix(type: DiffOperation["type"]): string {
  if (type === "add") {
    return "+";
  }
  if (type === "remove") {
    return "-";
  }
  return " ";
}

export function isMissingFileError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const record = err as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  const message = typeof record.message === "string" ? record.message : "";
  return (
    code === "EntryNotFound" ||
    code === "FileNotFound" ||
    code === "ENOENT" ||
    name === "EntryNotFound" ||
    message.includes("ENOENT") ||
    message.includes("EntryNotFound") ||
    message.includes("FileNotFound")
  );
}

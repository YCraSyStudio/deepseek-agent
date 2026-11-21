export interface DiffDocuments {
  before: string;
  after: string;
}

const HUNK_HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/;
const HUNK_SEPARATOR = ["", "", ""];

export function reconstructDiffDocuments(diff: string): DiffDocuments | null {
  const lines = diff.split("\n");
  if (
    lines.length < 3 ||
    !lines[0].startsWith("--- ") ||
    !lines[1].startsWith("+++ ") ||
    lines.some((line) => line.startsWith("... diff truncated"))
  ) {
    return null;
  }

  const before: string[] = [];
  const after: string[] = [];
  let foundHunk = false;
  let oldCount = 0;
  let newCount = 0;
  let expectedOldCount = 0;
  let expectedNewCount = 0;

  const finishHunk = (): boolean =>
    !foundHunk || (oldCount === expectedOldCount && newCount === expectedNewCount);

  for (let index = 2; index < lines.length; index += 1) {
    const line = lines[index];
    const header = HUNK_HEADER.exec(line);
    if (header) {
      if (!finishHunk()) {
        return null;
      }
      if (foundHunk) {
        before.push(...HUNK_SEPARATOR);
        after.push(...HUNK_SEPARATOR);
      }
      foundHunk = true;
      oldCount = 0;
      newCount = 0;
      expectedOldCount = Number(header[2]);
      expectedNewCount = Number(header[4]);
      continue;
    }

    if (!foundHunk) {
      return null;
    }
    if (line.startsWith("\\")) {
      continue;
    }

    const prefix = line[0];
    const content = line.slice(1);
    switch (prefix) {
      case " ":
        before.push(content);
        after.push(content);
        oldCount += 1;
        newCount += 1;
        break;
      case "-":
        before.push(content);
        oldCount += 1;
        break;
      case "+":
        after.push(content);
        newCount += 1;
        break;
      default:
        return null;
    }
  }

  return foundHunk && finishHunk()
    ? { before: before.join("\n"), after: after.join("\n") }
    : null;
}

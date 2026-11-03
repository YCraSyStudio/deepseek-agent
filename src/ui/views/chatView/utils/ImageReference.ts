export interface ImageReferenceInsertion {
  text: string;
  caret: number;
}

export function insertImageReference(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  reference: string,
): ImageReferenceInsertion {
  const start = clampSelection(selectionStart, text.length);
  const end = clampSelection(selectionEnd, text.length);
  const before = text.slice(0, start);
  const after = text.slice(Math.max(start, end));
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trailingSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const inserted = `${leadingSpace}${reference}${trailingSpace}`;
  return { text: before + inserted + after, caret: start + inserted.length };
}

function clampSelection(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.min(Math.max(0, Math.floor(value)), length);
}

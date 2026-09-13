import * as vscode from "vscode";

export interface InlineDiffPreview {
  show(uri: vscode.Uri, before: string, after: string): Promise<void>;
  clear(): void;
}

export function createInlineDiffPreview(): InlineDiffPreview {
  let activeEditor: vscode.TextEditor | undefined;
  let removalDecoration: vscode.TextEditorDecorationType | undefined;
  let additionDecoration: vscode.TextEditorDecorationType | undefined;

  function clear(): void {
    if (activeEditor && removalDecoration) {
      activeEditor.setDecorations(removalDecoration, []);
    }
    if (activeEditor && additionDecoration) {
      activeEditor.setDecorations(additionDecoration, []);
    }
    removalDecoration?.dispose();
    additionDecoration?.dispose();
    activeEditor = undefined;
    removalDecoration = undefined;
    additionDecoration = undefined;
  }

  async function show(uri: vscode.Uri, before: string, after: string): Promise<void> {
    clear();
    const document = await vscode.workspace.openTextDocument(uri);
    const focused = vscode.window.activeTextEditor;
    const editor = findVisibleEditor(document) ?? await vscode.window.showTextDocument(document, {
      preview: true,
      preserveFocus: true,
      viewColumn: findTabColumn(document) ?? vscode.ViewColumn.Active,
    });
    await restoreFocus(focused);
    const preview = computeInlinePreview(before, after, document);
    if (!preview) {
      return;
    }

    removalDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(244, 71, 71, 0.16)",
      overviewRulerColor: "rgba(244, 71, 71, 0.75)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    additionDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: preview.additionLabel,
        color: "rgba(137, 209, 133, 0.95)",
        margin: "0 0 0 1rem",
        fontStyle: "italic",
      },
      overviewRulerColor: "rgba(137, 209, 133, 0.75)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    if (preview.removalRange) {
      editor.setDecorations(removalDecoration, [preview.removalRange]);
    }
    if (preview.additionRange && preview.additionLabel) {
      editor.setDecorations(additionDecoration, [preview.additionRange]);
    }
    activeEditor = editor;
  }

  return { show, clear };
}

function computeInlinePreview(
  before: string,
  after: string,
  document: vscode.TextDocument,
): { removalRange?: vscode.Range; additionRange?: vscode.Range; additionLabel: string } | null {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }
  if (start === beforeLines.length && start === afterLines.length) {
    return null;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const additionLines = afterLines.slice(start, afterEnd + 1);
  return {
    removalRange: createRemovalRange(document, start, beforeEnd),
    additionRange: createAdditionAnchor(document, start),
    additionLabel: formatAdditionLabel(additionLines),
  };
}

function createRemovalRange(document: vscode.TextDocument, start: number, end: number): vscode.Range | undefined {
  if (end < start || document.lineCount === 0) {
    return undefined;
  }
  const firstLine = clampLine(start, document);
  const lastLine = clampLine(end, document);
  return new vscode.Range(firstLine, 0, lastLine, document.lineAt(lastLine).range.end.character);
}

function createAdditionAnchor(document: vscode.TextDocument, start: number): vscode.Range | undefined {
  if (document.lineCount === 0) {
    return undefined;
  }
  const anchorLine = clampLine(Math.max(start - 1, 0), document);
  const anchorCharacter = document.lineAt(anchorLine).range.end.character;
  return new vscode.Range(anchorLine, anchorCharacter, anchorLine, anchorCharacter);
}

function clampLine(line: number, document: vscode.TextDocument): number {
  return Math.max(0, Math.min(line, document.lineCount - 1));
}

function findVisibleEditor(document: vscode.TextDocument): vscode.TextEditor | undefined {
  const target = document.uri.toString(true);
  return vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString(true) === target);
}

function findTabColumn(document: vscode.TextDocument): vscode.ViewColumn | undefined {
  const target = document.uri.toString(true);
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString(true) === target) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

async function restoreFocus(previous: vscode.TextEditor | undefined): Promise<void> {
  if (!previous || vscode.window.activeTextEditor === previous) {
    return;
  }
  await previous.show(previous.viewColumn);
}

function formatAdditionLabel(lines: string[]): string {
  const meaningfulLines = lines.filter((line) => line.trim().length > 0);
  if (meaningfulLines.length === 0) {
    return "";
  }
  const firstLine = meaningfulLines[0]!.trim();
  const suffix = meaningfulLines.length > 1 ? ` … (+${meaningfulLines.length - 1} lines)` : "";
  return `  + ${truncatePreview(firstLine, 96)}${suffix}`;
}

function truncatePreview(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

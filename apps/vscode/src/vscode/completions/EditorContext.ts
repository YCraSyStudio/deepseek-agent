import * as vscode from "vscode";

export interface EditorTarget {
  range: vscode.Range;
  text: string;
  before: string;
  after: string;
  version: number;
}

export function allowsAutomaticCompletion(document: Pick<vscode.TextDocument, "uri" | "languageId">): boolean {
  return ["file", "untitled", "vscode-remote"].includes(document.uri.scheme) &&
    !["plaintext", "log", "dotenv"].includes(document.languageId) &&
    !/(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|\.ssh|credentials?(?:\.[^/\\]*)?|secrets?(?:\.[^/\\]*)?|[^/\\]+\.(?:pem|key|p12|pfx))(?:[/\\]|$)/i.test(document.uri.path);
}

export function surroundingCode(document: vscode.TextDocument, position: vscode.Position): { prefix: string; suffix: string } {
  const offset = document.offsetAt(position);
  const end = document.offsetAt(document.lineAt(document.lineCount - 1).range.end);
  return {
    prefix: document.getText(new vscode.Range(document.positionAt(Math.max(0, offset - 12_000)), position)),
    suffix: document.getText(new vscode.Range(position, document.positionAt(Math.min(end, offset + 4_000)))),
  };
}

export async function resolveEditorTarget(editor: vscode.TextEditor): Promise<EditorTarget> {
  const { document, selection } = editor;
  const version = document.version;
  const cursor = selection.active;
  let range: vscode.Range;
  if (!selection.isEmpty) {
    range = selection;
  } else if (!document.lineAt(cursor.line).text.trim()) {
    range = new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end);
  } else {
    const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
      "vscode.executeDocumentSymbolProvider", document.uri,
    );
    const candidates: vscode.Range[] = [];
    const collect = (items: Array<vscode.DocumentSymbol | vscode.SymbolInformation>) => {
      for (const item of items) {
        const candidate = "range" in item ? item.range : item.location.range;
        if (candidate.contains(cursor)) {
          candidates.push(candidate);
          if ("children" in item) {collect(item.children);}
        }
      }
    };
    collect(symbols ?? []);
    candidates.sort((a, b) => (document.offsetAt(a.end) - document.offsetAt(a.start)) - (document.offsetAt(b.end) - document.offsetAt(b.start)));
    range = candidates[0] ?? document.lineAt(cursor.line).range;
    if (!candidates.length) {
      const selections = await vscode.commands.executeCommand<vscode.SelectionRange[]>(
        "vscode.executeSelectionRangeProvider", document.uri, [cursor],
      );
      for (let candidate = selections?.[0]; candidate; candidate = candidate.parent!) {
        if (candidate.range.contains(range) && !candidate.range.isEqual(range)) {
          range = candidate.range;
          break;
        }
      }
    }
  }
  if (document.version !== version) {throw new Error("The document changed. Run the command again.");}
  const text = document.getText(range);
  if (Buffer.byteLength(text, "utf8") > 128 * 1024) {throw new Error("Select a smaller scope (at most 128 KiB).");}
  return {
    range, text, version,
    before: surroundingCode(document, range.start).prefix.slice(-4_000),
    after: surroundingCode(document, range.end).suffix,
  };
}

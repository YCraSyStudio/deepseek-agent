import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { CompletionService } from "./CompletionService";
import { allowsAutomaticCompletion, resolveEditorTarget, surroundingCode } from "./EditorContext";
import { logWarning } from "@/shared/logging/Logger";

export function registerEditorFeatures(context: vscode.ExtensionContext, service: CompletionService): void {
  const previews = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("ycrasy-edit-preview", {
      provideTextDocumentContent: (uri) => previews.get(uri.toString()) ?? "",
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {previews.delete(document.uri.toString());}),
    vscode.languages.registerInlineCompletionItemProvider([
      { scheme: "file" }, { scheme: "untitled" }, { scheme: "vscode-remote" },
    ], createEditorCompletionProvider(service)),
    vscode.commands.registerCommand("deepseek-agent.completeEditor", () => edit("complete")),
    vscode.commands.registerCommand("deepseek-agent.refactorEditor", () => edit("refactor")),
  );

  async function edit(action: "complete" | "refactor"): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !["file", "untitled", "vscode-remote"].includes(editor.document.uri.scheme)) {return;}
    const document = editor.document;
    const spanish = vscode.env.language.startsWith("es");
    try {
      const target = await resolveEditorTarget(editor);
      const replacement = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: action === "complete" ? (spanish ? "Completando código…" : "Completing code…") : (spanish ? "Refactorizando…" : "Refactoring…"),
        cancellable: true,
      }, async (_progress, token) => {
        const controller = new AbortController();
        const cancelled = token.onCancellationRequested(() => controller.abort());
        try {
          return await service.edit(action, target.text, document.languageId, target.before, target.after,
            AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]));
        } finally {cancelled.dispose();}
      });
      if (document.isClosed || document.version !== target.version) {throw new Error("The document changed; the suggestion was not applied. Run the command again.");}
      const text = document.eol === vscode.EndOfLine.CRLF ? replacement.replace(/\r?\n/g, "\r\n") : replacement.replace(/\r\n/g, "\n");
      if (text === target.text) {await vscode.window.showInformationMessage(spanish ? "No hay cambios propuestos." : "No changes proposed."); return;}
      const before = document.getText();
      const after = before.slice(0, document.offsetAt(target.range.start)) + text + before.slice(document.offsetAt(target.range.end));
      const id = randomUUID();
      const name = document.uri.path.split("/").pop() || "code";
      const left = vscode.Uri.from({ scheme: "ycrasy-edit-preview", path: `/${id}/before/${name}` });
      const right = vscode.Uri.from({ scheme: "ycrasy-edit-preview", path: `/${id}/after/${name}` });
      previews.set(left.toString(), before);
      previews.set(right.toString(), after);
      while (previews.size > 24) {previews.delete(previews.keys().next().value!);}
      await vscode.commands.executeCommand("vscode.diff", left, right, `YCraSy DeepSeek Agent — ${name}`, { preview: true });
      const apply = spanish ? "Aplicar" : "Apply";
      const discard = spanish ? "Descartar" : "Discard";
      const choice = await vscode.window.showInformationMessage(spanish ? "Revisa los cambios propuestos." : "Review the proposed changes.", apply, discard);
      if (choice !== apply) {return;}
      if (document.isClosed || document.version !== target.version) {throw new Error("The document changed; the suggestion was not applied. Run the command again.");}
      const active = await vscode.window.showTextDocument(document);
      if (document.version !== target.version) {throw new Error("The document changed; the suggestion was not applied. Run the command again.");}
      if (!await active.edit((builder) => builder.replace(target.range, text), { undoStopBefore: true, undoStopAfter: true })) {
        throw new Error("Could not apply the edit.");
      }
    } catch (error) {
      if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {return;}
      logWarning("[EditorCompletion] Edit failed", error);
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : "Could not generate the edit.");
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {clearTimeout(timer); reject(signal.reason);};
    const timer = setTimeout(() => {signal.removeEventListener("abort", abort); resolve();}, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function createEditorCompletionProvider(service: CompletionService): vscode.InlineCompletionItemProvider {
  return {
    async provideInlineCompletionItems(document, position, completionContext, token) {
      const editor = vscode.window.activeTextEditor;
      if (!service.enabled("editor") || !allowsAutomaticCompletion(document) || !editor?.selection.isEmpty ||
        editor.document !== document || !editor.selection.active.isEqual(position)) {return [];}
      const version = document.version;
      const controller = new AbortController();
      const cancel = token.onCancellationRequested(() => controller.abort());
      try {
        if (token.isCancellationRequested) {return [];}
        if (completionContext.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
          await delay(700, controller.signal);
        }
        if (document.version !== version || controller.signal.aborted) {return [];}
          const selected = completionContext.selectedCompletionInfo;
          const { prefix, suffix } = selected
            ? { prefix: (surroundingCode(document, selected.range.start).prefix + selected.text).slice(-12_000),
              suffix: surroundingCode(document, selected.range.end).suffix }
            : surroundingCode(document, position);
        const text = await service.suggest("editor", prefix, suffix, controller.signal);
        if (!text || controller.signal.aborted || token.isCancellationRequested || document.version !== version ||
          !service.enabled("editor") || vscode.window.activeTextEditor?.document !== document ||
          !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) {return [];}
        const normalized = document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, "\r\n") : text.replace(/\r\n/g, "\n");
          return [new vscode.InlineCompletionItem((selected?.text ?? "") + normalized, selected?.range ?? new vscode.Range(position, position))];
      } catch (error) {
        if (!controller.signal.aborted && !token.isCancellationRequested) {
          logWarning("[EditorCompletion] Suggestion unavailable", error);
        }
        return [];
      } finally {cancel.dispose();}
    },
  };
}

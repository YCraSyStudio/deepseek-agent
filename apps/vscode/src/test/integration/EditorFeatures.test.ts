import assert from "node:assert/strict";
import * as vscode from "vscode";
import { resolveEditorTarget, allowsAutomaticCompletion } from "@/vscode/completions/EditorContext";
import { createEditorCompletionProvider } from "@/vscode/completions/EditorFeatures";
import { CompletionService } from "@/vscode/completions/CompletionService";
import { DEFAULT_CONFIG } from "@/contracts";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import type { createBetaCodeCompleter } from "@/infrastructure/deepseek/provider/features/CodeCompletion";

suite("Editor integrations", () => {
  test("selects the innermost symbol, the whole file on a blank line, and explicit selections first", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: "class Outer {\n  method() {\n    return 1;\n\n  }\n}\n" });
    const editor = await vscode.window.showTextDocument(document);
    const provider = vscode.languages.registerDocumentSymbolProvider({ language: "plaintext" }, {
      provideDocumentSymbols: () => {
        const outer = new vscode.DocumentSymbol("Outer", "", vscode.SymbolKind.Class, new vscode.Range(0, 0, 5, 1), new vscode.Range(0, 6, 0, 11));
        outer.children = [new vscode.DocumentSymbol("method", "", vscode.SymbolKind.Method, new vscode.Range(1, 0, 4, 3), new vscode.Range(1, 2, 1, 8))];
        return [outer];
      },
    });
    try {
      editor.selection = new vscode.Selection(2, 6, 2, 6);
      const target = await resolveEditorTarget(editor);
      assert.equal(target.range.start.line, 1);
      assert.equal(target.range.end.line, 4);
      editor.selection = new vscode.Selection(3, 0, 3, 0);
      assert.equal((await resolveEditorTarget(editor)).text, document.getText());
      editor.selection = new vscode.Selection(2, 4, 2, 13);
      assert.equal((await resolveEditorTarget(editor)).text, "return 1;");
    } finally {provider.dispose(); await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");}
  });

  test("returns a native zero-width inline suggestion at the caret", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "javascript", content: "const value = " });
    const editor = await vscode.window.showTextDocument(document);
    const position = document.lineAt(0).range.end;
    editor.selection = new vscode.Selection(position, position);
    const fixture = completions(async () => "42;");
    const token = new vscode.CancellationTokenSource();
    try {
      const result = await createEditorCompletionProvider(fixture.service).provideInlineCompletionItems(document, position,
        { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, token.token);
      const items = Array.isArray(result) ? result : result?.items ?? [];
      assert.equal(items.length, 1);
      assert.equal(items[0].insertText, "42;");
      assert.ok(items[0].range?.isEmpty);
      assert.equal(fixture.calls(), 1);
    } finally {token.dispose(); await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");}
  });

  test("continues the selected IntelliSense candidate without replacing unrelated code", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "javascript", content: "con" });
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(0, 3);
    editor.selection = new vscode.Selection(position, position);
    const fixture = completions(async () => ".log(value);");
    const token = new vscode.CancellationTokenSource();
    try {
      const result = await createEditorCompletionProvider(fixture.service).provideInlineCompletionItems(document, position,
        { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: { range: new vscode.Range(0, 0, 0, 3), text: "console" } }, token.token);
      const items = Array.isArray(result) ? result : result?.items ?? [];
      assert.equal(items[0].insertText, "console.log(value);");
      assert.ok(items[0].range?.isEqual(new vscode.Range(0, 0, 0, 3)));
    } finally {token.dispose(); await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");}
  });

  test("drops results when the user edits or moves the caret during the request", async () => {
    for (const change of ["document", "caret"]) {
      const document = await vscode.workspace.openTextDocument({ language: "javascript", content: "const value = " });
      const editor = await vscode.window.showTextDocument(document);
      const position = document.lineAt(0).range.end;
      editor.selection = new vscode.Selection(position, position);
      let release!: (value: string) => void;
      let started!: () => void;
      const began = new Promise<void>(resolve => {started = resolve;});
      const fixture = completions(async () => {started(); return await new Promise<string>(resolve => {release = resolve;});});
      const token = new vscode.CancellationTokenSource();
      try {
        const request = createEditorCompletionProvider(fixture.service).provideInlineCompletionItems(document, position,
          { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, token.token);
        await began;
        if (change === "document") {await editor.edit(builder => builder.insert(position, "x"));}
        else {editor.selection = new vscode.Selection(0, 0, 0, 0);}
        release("outdated;");
        const result = await request;
        assert.deepEqual(result, []);
      } finally {token.dispose(); await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");}
    }
  });

  test("does not request completions for sensitive files or cancelled invocations", async () => {
    assert.equal(allowsAutomaticCompletion({ uri: vscode.Uri.file("/fixture/.env.local"), languageId: "shellscript" }), false);
    assert.equal(allowsAutomaticCompletion({ uri: vscode.Uri.file("/fixture/private.key"), languageId: "javascript" }), false);
    assert.equal(allowsAutomaticCompletion({ uri: vscode.Uri.parse("ycrasy-change:/preview.ts"), languageId: "typescript" }), false);
    const document = await vscode.workspace.openTextDocument({ language: "javascript", content: "const value = " });
    const editor = await vscode.window.showTextDocument(document);
    const position = document.lineAt(0).range.end;
    editor.selection = new vscode.Selection(position, position);
    const token = new vscode.CancellationTokenSource();token.cancel();
    const fixture = completions(async () => "42;");
    try {
      assert.deepEqual(await createEditorCompletionProvider(fixture.service).provideInlineCompletionItems(document, position,
        { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, token.token), []);
      assert.equal(fixture.calls(), 0);
    } finally {token.dispose(); await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");}
  });
});

function completions(run: () => Promise<string>) {
  let count = 0;
  const settings = { load: () => ({ ...DEFAULT_CONFIG, betaFeaturesEnabled: true }), getRevision: () => 1,
    waitForPendingWrites: async () => undefined } as unknown as SettingsRepository;
  const secrets = { getApiKey: async () => "fixture-key" } as unknown as SecretStore;
  const factory: typeof createBetaCodeCompleter = () => async () => {count++; return JSON.stringify({ content: await run(), finish_reason: "stop" });};
  return { service: new CompletionService(settings, secrets, {} as ModelProviderFactory, () => true, undefined, factory), calls: () => count };
}

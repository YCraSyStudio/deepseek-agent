import * as assert from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ChatCompletionRequest, ChatCompletionResponse, StreamChunk } from "@/contracts";
import { DEFAULT_CONFIG } from "@/contracts/Config";
import { ConversationState } from "@/application/chat/ConversationState";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import type { ModelProvider } from "@/application/ports";
import { searchContentHandler } from "@/infrastructure/tools/builtins/fileSystem/SearchContent";
import { runWithToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";
import { ChangeDiffViewer } from "@/vscode/editor/diff/ChangeDiffViewer";
import { fileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot, type WorkspaceRunSnapshot } from "@/vscode/workspace";
import { getPathCompletionItems } from "@/vscode/editor/EditorActions";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import { VsCodeSettingsRepository } from "@/vscode/storage/RepositoryAdapters";
import { fitGenerationRequestContext } from "@/vscode/webviews/handlers/chat/generation/GenerationContext";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";

const settingsRepository = new VsCodeSettingsRepository();

suite("Extension integration", () => {
  test("activates under the Marketplace identifier and registers its main command", async () => {
    const extension = vscode.extensions.getExtension("yarcrasy.deepseek-agent");

    assert.ok(extension, "The development extension should be discoverable by its Marketplace identifier.");
    const testDataDirectory = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    assert.ok(testDataDirectory);
    const historyDirectory = path.join(testDataDirectory, "history");
    const incompatiblePaths = [
      path.join(historyDirectory, "unversioned-integration.json"),
      path.join(historyDirectory, "unsupported-integration.json"),
      path.join(historyDirectory, "malformed-integration.json"),
    ];

    await extension.activate();

    assert.strictEqual(extension.isActive, true);
    const manager = new HistoryManager(settingsRepository);
    await manager.initialize();
    await manager.getSummaries();
    for (const incompatiblePath of incompatiblePaths) {
      await assert.rejects(access(incompatiblePath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    }
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("deepseek-agent.openChat"));
    assert.ok(commands.includes("deepseek-agent.startSearxng"));
    assert.ok(commands.includes("deepseek-agent.stopSearxng"));
    assert.strictEqual(commands.includes("deepseek-agent.installChromiumHeadless"), false);
    assert.strictEqual(commands.includes("deepseek-agent.updateChromiumHeadless"), false);
    assert.strictEqual(commands.includes("deepseek-agent.removeChromiumHeadless"), false);
  });

  test("captures a revisioned workspace binding and rejects parent autocomplete", async () => {
    const binding = captureCurrentWorkspaceBinding();
    assert.strictEqual(binding.folders.length, 1);
    assert.ok(binding.folders[0]?.alias);
    assert.ok(binding.revision);
    assert.deepStrictEqual(await getPathCompletionItems("../", binding), []);
    const resolvedTerminalRoot = await createVsCodeToolWorkspace().resolveLocalPath!();
    assert.strictEqual(resolvedTerminalRoot.workspaceRoot, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  });

  test("keeps the multi-root virtual root listable but rejects it as a terminal cwd", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const folders = ["frontend", "backend"].map((alias) => ({
      uri: workspaceFolder.uri.toString(),
      name: alias,
      alias,
      scheme: workspaceFolder.uri.scheme,
      rootUri: workspaceFolder.uri,
      localPath: workspaceFolder.uri.fsPath,
    }));
    const snapshot: WorkspaceRunSnapshot = {
      binding: {
        schemaVersion: 1,
        uri: "ycrasy-workspace:test-multi-root",
        name: "Test multi-root",
        revision: "test-revision",
        folders,
        capabilities: { files: true, search: true, git: true, terminal: true },
      },
      folders,
      defaultFolderAlias: "frontend",
    };
    const host = createVsCodeToolWorkspace(snapshot);

    assert.strictEqual(await host.resolvePath!(".", false), ".");
    await assert.rejects(host.resolveLocalPath!("."), /must start with one of/);
    assert.strictEqual((await host.resolveLocalPath!()).workspaceRoot, workspaceFolder.uri.fsPath);
  });

  test("exposes external paths only through an explicitly permissive generation host", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot);
    const externalPath = path.dirname(workspaceRoot);
    const restrictedHost = createVsCodeToolWorkspace();
    const permissiveHost = createVsCodeToolWorkspace(undefined, { allowOutsideWorkspace: true });

    await assert.rejects(restrictedHost.resolvePath!(externalPath, false), /relative to the selected workspace/);
    assert.strictEqual(await permissiveHost.resolvePath!(externalPath, false), path.resolve(externalPath));
    assert.strictEqual(await permissiveHost.isPathInsideWorkspace!(externalPath), false);
  });

  test("reads only bounded head and tail excerpts for large local files", async () => {
    const host = createVsCodeToolWorkspace();
    const preview = await host.readFilePreview!("package-lock.json", 1_024);

    assert.ok(preview.size > 1_024);
    assert.strictEqual(preview.head.byteLength, 512);
    assert.strictEqual(preview.tail?.byteLength, 512);
    assert.match(Buffer.from(preview.head).toString("utf8"), /^\{/);
    assert.match(Buffer.from(preview.tail!).toString("utf8"), /}\s*$/);
  });

  test("reads and edits the authoritative open buffer with undo support", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const fileName = `open-buffer-${randomUUID()}.txt`;
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
    await vscode.workspace.fs.writeFile(uri, Buffer.from("saved\n"));

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      const userEdit = new vscode.WorkspaceEdit();
      userEdit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), "unsaved user text\n");
      assert.strictEqual(await vscode.workspace.applyEdit(userEdit), true);
      assert.strictEqual(document.isDirty, true);

      const host = createVsCodeToolWorkspace();
      assert.strictEqual(Buffer.from(await host.readFile(fileName)).toString("utf8"), "unsaved user text\n");
      await host.writeFile(fileName, Buffer.from("unsaved user text plus tool change\n"));
      assert.strictEqual(document.getText(), "unsaved user text plus tool change\n");
      assert.strictEqual(document.isDirty, true);

      await vscode.commands.executeCommand("undo");
      assert.strictEqual(document.getText(), "unsaved user text\n");
    } finally {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    }
  });

  test("previews a pending edit without moving focus away from the user's editor", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const userUri = vscode.Uri.joinPath(workspaceFolder.uri, `user-focus-${randomUUID()}.txt`);
    const editedUri = vscode.Uri.joinPath(workspaceFolder.uri, `pending-edit-${randomUUID()}.txt`);
    await vscode.workspace.fs.writeFile(userUri, Buffer.from("the user keeps typing here\n"));
    await vscode.workspace.fs.writeFile(editedUri, Buffer.from("alpha\n"));

    try {
      const editedEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(editedUri));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(userUri), {
        viewColumn: vscode.ViewColumn.Beside,
      });
      await expectActiveEditor(userUri, "The user's editor must already be the active one before the preview runs.");

      const host = createVsCodeToolWorkspace();
      await host.prepareFileDiff!(path.basename(editedUri.fsPath), "alpha\n", "beta\n");

      await expectActiveEditor(userUri, "A pending edit preview must not take focus from the user's editor.");
      const previewEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString(true) === editedUri.toString(true),
      );
      assert.ok(previewEditor, "The pending edit should stay visible in the editor area.");
      assert.strictEqual(previewEditor.viewColumn, editedEditor.viewColumn);
      assert.strictEqual(previewEditor.document.getText(), "alpha\n");
      host.clearFileDiffPreview?.();
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.workspace.fs.delete(userUri, { useTrash: false });
      await vscode.workspace.fs.delete(editedUri, { useTrash: false });
    }
  });

  test("records a completed write so the chat can review the exact change", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const fileName = `reviewed-change-${randomUUID()}.txt`;
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
    await vscode.workspace.fs.writeFile(uri, Buffer.from("before\n"));

    const viewer = new ChangeDiffViewer();
    try {
      const host = createVsCodeToolWorkspace();
      const before = await host.readFile(fileName);
      const after = Buffer.from("after\n");
      await host.writeFile(fileName, after);

      const recorded = fileChangeRegistry.find(fileName, sha256(before), sha256(after));
      assert.ok(recorded, "A completed write should stay reviewable during the session.");
      assert.strictEqual(recorded.before, "before\n");
      assert.strictEqual(recorded.after, "after\n");

      await viewer.open(
        { path: fileName, beforeHash: sha256(before), afterHash: sha256(after) },
        captureCurrentWorkspaceBinding(),
      );

      const diffTab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputTextDiff && tab.label.includes(fileName));
      assert.ok(diffTab, "The recorded change should open as a native diff for the edited file.");
    } finally {
      viewer.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    }
  });

  test("rejects a stale conversation save from another manager instance", async () => {
    const extension = vscode.extensions.getExtension("yarcrasy.deepseek-agent");
    assert.ok(extension);
    const first = new HistoryManager(settingsRepository);
    const second = new HistoryManager(settingsRepository);
    await Promise.all([first.initialize(), second.initialize()]);
    const binding = captureCurrentWorkspaceBinding();
    const id = `concurrent-${randomUUID()}`;
    const now = Date.now();
    const base = {
      schemaVersion: 2 as const,
      id,
      title: "Concurrent test",
      createdAt: now,
      model: "deepseek-flash",
      workspaceUri: binding.uri,
      workspaceBinding: binding,
      messages: [],
    };
    try {
      await first.save({ ...base, updatedAt: now + 2 });
      await assert.rejects(second.save({ ...base, updatedAt: now + 1 }), /changed in another VS Code window/);
    } finally {
      await first.delete(id);
    }
  });

  test("searches literal workspace content through the VS Code filesystem without exposing sensitive files", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, "The integration test must run with the repository open as a workspace.");

    const directoryName = `search-content-${randomUUID()}`;
    const testDirectoryUri = vscode.Uri.joinPath(workspaceFolder.uri, directoryName);
    await vscode.workspace.fs.createDirectory(testDirectoryUri);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(testDirectoryUri, "safe file.txt"),
      Buffer.from("marker [literal] & value\n"),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(testDirectoryUri, "credentials.json"),
      Buffer.from("marker [literal] & value\n"),
    );

    try {
      const host = createVsCodeToolWorkspace();
      const result = await runWithToolWorkspaceHost(host, () => searchContentHandler({
        query: "[literal] & value",
        filePattern: `${directoryName}/*`,
      }));
      const payload = JSON.parse(result) as {
        type?: string;
        results?: Array<{ file: string; line: number; text: string }>;
      };

      assert.strictEqual(payload.type, "SearchResults");
      assert.deepStrictEqual(payload.results, [{
        file: `${directoryName}/safe file.txt`,
        line: 1,
        text: "marker [literal] & value",
      }]);
    } finally {
      await vscode.workspace.fs.delete(testDirectoryUri, { recursive: true, useTrash: false });
    }
  });

  test("runs initial compaction through starting, compacting and streaming exactly once", async () => {
    const binding = captureCurrentWorkspaceBinding();
    const state = new ConversationState({
      save: async () => undefined,
      getWorkspaceBinding: () => binding,
    });
    const generationId = "generation-current";
    const oldContent = "historical context ".repeat(15_000);
    state.load({
      schemaVersion: 2,
      id: "compaction-integration",
      title: "Compaction",
      createdAt: 1,
      updatedAt: 1,
      model: "custom-model",
      workspaceUri: binding.uri,
      workspaceBinding: binding,
      messages: [
        { id: "old-user", role: "user", content: oldContent, createdAt: 1, generationId: "generation-old" },
        { id: "old-assistant", role: "assistant", content: oldContent, createdAt: 2, generationId: "generation-old" },
      ],
    });
    const budgetManager = new GenerationBudgetManager("custom-model", 8_192);
    const record = {
      generationId,
      conversationId: "compaction-integration",
      status: "starting",
      budgetManager,
    } as GenerationRunRecord;
    const events: Array<Record<string, unknown>> = [];
    const checkpointStatuses: string[] = [];
    const messages = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: oldContent },
      { role: "assistant" as const, content: oldContent },
      { role: "user" as const, content: "continue" },
    ];

    const compacted = await fitGenerationRequestContext({
      messages,
      payload: { clientRequestId: "request", text: "continue", modelId: "custom-model", reasoning: "high" },
      config: { ...DEFAULT_CONFIG, model: "custom-model", maxTokens: 8_192 },
      provider: new SummaryProvider(),
      state,
      eventSink: { publish: (event) => {events.push(event as Record<string, unknown>);} },
      workspaceSnapshot: captureWorkspaceRunSnapshot(binding),
      generationId,
      record,
      tools: [],
      permissionMode: "default",
      enabledTools: [],
      signal: new AbortController().signal,
      checkpoint: async (run) => {checkpointStatuses.push(run.status);},
    });

    assert.strictEqual(record.status, "streaming");
    assert.ok(budgetManager.assessRequest(compacted, []).status !== "hard_limit");
    assert.deepStrictEqual(checkpointStatuses, ["compacting"]);
    assert.deepStrictEqual(
      events.filter((event) => event.type === "contextCompactionUpdated" || event.type === "contextCompacted")
        .map((event) => event.type === "contextCompactionUpdated" ? `${event.type}:${event.status}` : event.type),
      ["contextCompactionUpdated:compacting", "contextCompacted", "contextCompactionUpdated:completed"],
    );
    assert.strictEqual(state.getConversation()?.messages.filter((message) => message.role === "context").length, 1);
  });
});

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function expectActiveEditor(uri: vscode.Uri, message: string): Promise<void> {
  const expected = uri.toString(true);
  const deadline = Date.now() + 4_000;
  let actual = activeEditorUri();
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    actual = activeEditorUri();
  }
  assert.strictEqual(actual, expected, message);
}

function activeEditorUri(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.toString(true);
}

class SummaryProvider implements ModelProvider {
  readonly id = "summary";
  readonly name = "summary";

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return {
      id: "summary",
      object: "chat.completion",
      created: 1,
      model: request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Compact summary" } }],
    };
  }

  async chatCompletionStream(_request: ChatCompletionRequest, _onChunk: (chunk: StreamChunk) => void): Promise<void> {}
  async testConnection(): Promise<{ success: boolean }> {return { success: true };}
  async listModels(): Promise<Array<{ id: string; name: string }>> {return [];}
}

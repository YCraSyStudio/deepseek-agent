import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ChangeDiffViewer } from "@/vscode/editor/diff/ChangeDiffViewer";
import { fileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import { dialogs, hostEvents, hostState, resetVsCodeMock, TabInputTextDiff, Uri, window as vscodeWindow, workspace } from "../../../support/VsCodeMock";

suite("change diff viewer", () => {
  let root: string;
  let viewer: ChangeDiffViewer;
  let reverted: Array<{ conversationId: string; generationId: string }>;

  setup(async () => {
    resetVsCodeMock();
    fileChangeRegistry.clear();
    root = await mkdtemp(path.join(tmpdir(), "change-diff-"));
    const folder = path.join(root, "workspace");
    await mkdir(path.join(folder, "src"), { recursive: true });
    workspace.workspaceFolders = [{ uri: Uri.file(folder), name: "workspace" }];
    reverted = [];
    viewer = new ChangeDiffViewer(async (scope) => {
      reverted.push(scope);
      if ((globalThis as { __revertError?: boolean }).__revertError) { throw new Error("Revert failed"); }
    });
  });

  teardown(async () => {
    viewer.dispose();
    resetVsCodeMock();
    fileChangeRegistry.clear();
    delete (globalThis as { __revertError?: boolean }).__revertError;
    await rm(root, { recursive: true, force: true });
  });

  function recordedChange() {
    const change = fileChangeRegistry.record("src/a.ts", Buffer.from("before line"), Buffer.from("after line"));
    assert.ok(change);
    return change;
  }

  test("opens a recorded change and retains both sides", async () => {
    const change = recordedChange();
    await viewer.open({ path: "src/a.ts", beforeHash: change.beforeHash, afterHash: change.afterHash, conversationId: "chat", generationId: "generation" }, captureCurrentWorkspaceBinding());

    const call = hostState.commandCalls.at(-1);
    assert.equal(call?.command, "vscode.diff");
    const [beforeUri, afterUri, label, options] = call!.args as [{ toString(): string }, { toString(): string }, string, { preview: boolean }];
    assert.equal(label, "a.ts — DeepSeek change");
    assert.deepEqual(options, { preview: true });
    const provider = hostState.textProviders.get("ycrasy-change") as { provideTextDocumentContent(uri: unknown): string };
    assert.equal(provider.provideTextDocumentContent(beforeUri), "before line");
    assert.equal(provider.provideTextDocumentContent(afterUri), "after line");

    hostEvents.closedDocument.fire({ uri: beforeUri as never });
    assert.equal(provider.provideTextDocumentContent(beforeUri), "");
  });

  test("reports incomplete changes and refuses paths outside the workspace", async () => {
    await viewer.open({ path: "src/a.ts" }, captureCurrentWorkspaceBinding());
    assert.match(String(dialogs.errors.at(-1)?.[0]), /saved change is incomplete/);

    await viewer.open({ path: "../escape.ts", diff: "--- a\n+++ b\n" }, captureCurrentWorkspaceBinding());
    assert.equal(dialogs.errors.length, 2);
    assert.ok(/outside|workspace|path/i.test(String(dialogs.errors.at(-1)?.[0])));
  });

  test("rejects diffs that exceed the recorded line budget", async () => {
    const diff = `--- a\n+++ b\n${"\n".repeat(20_001)}`;
    await viewer.open({ path: "src/a.ts", diff }, captureCurrentWorkspaceBinding());
    assert.match(String(dialogs.errors.at(-1)?.[0]), /saved change is incomplete/);
  });

  test("sanitizes file names and falls back to change.txt", async () => {
    await viewer.openSaved("src/a?.ts", { before: "x", after: "y" }, { conversationId: "chat", generationId: "generation" }, false);
    assert.equal((hostState.commandCalls.at(-1)!.args as unknown[])[2], "a_.ts — DeepSeek change");
    assert.deepEqual((hostState.commandCalls.at(-1)!.args as unknown[])[3], { preview: false });

    await viewer.openSaved("/", { before: "x", after: "y" });
    assert.equal((hostState.commandCalls.at(-1)!.args as unknown[])[2], "change.txt — DeepSeek change");
  });

  test("bounds retained preview documents", async () => {
    const provider = hostState.textProviders.get("ycrasy-change") as { provideTextDocumentContent(uri: unknown): string };
    const uris: Array<{ toString(): string }> = [];
    for (let index = 0; index < 13; index += 1) {
      await viewer.openSaved(`src/file-${index}.ts`, { before: `before ${index}`, after: `after ${index}` });
      uris.push((hostState.commandCalls.at(-1)!.args as unknown[])[0] as { toString(): string });
    }
    assert.equal(provider.provideTextDocumentContent(uris[0]), "");
    assert.equal(provider.provideTextDocumentContent(uris.at(-1)), "before 12");
  });

  test("reverts the reviewed turn from the active diff tab", async () => {
    await viewer.openSaved("src/a.ts", { before: "x", after: "y" }, { conversationId: "chat", generationId: "generation" });
    const [beforeUri, afterUri] = (hostState.commandCalls.at(-1)!.args as unknown[]).slice(0, 2) as Array<{ toString(): string }>;
    const revert = hostState.commandHandlers.get("deepseek-agent.revertReviewedTurn");
    assert.ok(revert);

    (vscodeWindow as unknown as { tabGroups: { activeTabGroup: { activeTab?: { input?: unknown } } } }).tabGroups.activeTabGroup.activeTab = { input: new TabInputTextDiff(beforeUri as never, afterUri as never) };
    await revert!();
    assert.deepEqual(reverted, [{ conversationId: "chat", generationId: "generation" }]);

    (globalThis as { __revertError?: boolean }).__revertError = true;
    await revert!();
    assert.match(String(dialogs.errors.at(-1)?.[0]), /Revert failed/);
    (globalThis as { __revertError?: boolean }).__revertError = false;

    (vscodeWindow as unknown as { tabGroups: { activeTabGroup: { activeTab?: { input?: unknown } } } }).tabGroups.activeTabGroup.activeTab = undefined;
    vscodeWindow.activeTextEditor = { document: { uri: Uri.file("/elsewhere/a.ts") } } as never;
    await revert!();
    assert.match(String(dialogs.errors.at(-1)?.[0]), /no recoverable turn snapshot/);

    vscodeWindow.activeTextEditor = { document: { uri: beforeUri } } as never;
    await revert!();
    assert.equal(reverted.length, 3);
  });
});

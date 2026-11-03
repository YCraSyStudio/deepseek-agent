import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type * as vscode from "vscode";
import type { ReferencedFilePayload } from "@/contracts";
import type { WebviewProvider } from "@/vscode/webviews/WebviewProvider";
import { registerChatCommands } from "@/vscode/commands/ChatCommands";
import { commands, dialogs, hostState, resetVsCodeMock, Uri, window, workspace } from "../../../support/VsCodeMock";

const execute = promisify(execFile);

suite("registered chat command behavior", () => {
  let temporary: string;
  let project: string;
  let references: ReferencedFilePayload[][];
  let drafts: string[];
  let newChats: number;
  let subscriptions: Array<{ dispose(): void }>;
  setup(async () => {
    resetVsCodeMock(); temporary = await mkdtemp(path.join(tmpdir(), "chat-command-tests-")); project = path.join(temporary, "project"); await mkdir(project);
    workspace.workspaceFolders = [{ uri: Uri.file(project), name: "Project" }]; references = []; drafts = []; newChats = 0; subscriptions = [];
    const provider = { addReferencedFiles: async (files: ReferencedFilePayload[]) => { references.push(files); }, setDraft: async (text: string) => { drafts.push(text); }, startNewChat: async () => { newChats++; } } as unknown as WebviewProvider;
    registerChatCommands({ subscriptions } as unknown as vscode.ExtensionContext, provider);
  });
  teardown(async () => { subscriptions.forEach((subscription) => subscription.dispose()); resetVsCodeMock(); await rm(temporary, { recursive: true, force: true }); });
  const addFiles = (...args: unknown[]) => commands.executeCommand("deepseek-agent.addFileToChat", ...args);
  async function file(name: string, content: string | Buffer = "contents", external = false) { const target = path.join(external ? temporary : project, name); await writeFile(target, content); return Uri.file(target); }

  test("registers disposable commands and delegates new-chat creation", async () => {
    assert.equal(hostState.commandHandlers.size, 4); await commands.executeCommand("deepseek-agent.newChat"); assert.equal(newChats, 1);
    subscriptions.forEach((subscription) => subscription.dispose()); assert.equal(hostState.commandHandlers.size, 0);
  });
  test("file commands deduplicate selections and retain workspace metadata", async () => {
    const first = await file("first.ts", "export const value = 1;"); const second = await file("second.md", "Notes");
    await addFiles(first, [first, second, first]);
    assert.equal(references.length, 1); assert.equal(references[0]!.length, 2);
    assert.equal(references[0]![0]!.path, "./first.ts"); assert.equal(references[0]![0]!.scope, "workspace");
    assert.equal(references[0]![0]!.rootUri, Uri.file(project).toString()); assert.equal(references[0]![0]!.language, "ts");
    assert.equal(references[0]![0]!.content, "export const value = 1;"); assert.equal(typeof references[0]![0]!.referenceId, "string");
  });
  test("an empty selection uses the explicit URI and limits huge multiselects to fifty files", async () => {
    const first = await file("first.txt"); await addFiles(first, []); assert.equal(references[0]![0]!.name, "first.txt");
    const files = await Promise.all(Array.from({ length: 51 }, (_, index) => file(`item-${index}.txt`)));
    await addFiles(undefined, files); assert.equal(references[1]!.length, 50);
  });
  test("the active editor is used when no URI is supplied", async () => {
    const uri = await file("active.txt", "active"); window.activeTextEditor = editor(uri, "active");
    await addFiles(); assert.equal(references[0]![0]!.name, "active.txt");
  });
  test("missing, directory and inaccessible selections produce guidance without a reference", async () => {
    await addFiles(); await addFiles(Uri.file(project)); await addFiles(Uri.file(path.join(project, "absent.txt")));
    assert.equal(references.length, 0); assert.equal(dialogs.informationMessages.length, 3);
  });
  test("oversized workspace files are referenced without reading their contents", async () => {
    const uri = await file("large.txt", "x".repeat(1024 * 1024 + 1)); await addFiles(uri);
    assert.equal(references[0]![0]!.content, undefined); assert.equal(references[0]![0]!.size, 1024 * 1024 + 1);
  });
  test("external snapshots have bounded content and keep a basename rather than a machine path", async () => {
    const uri = await file("external.txt", "external text", true); await addFiles(uri);
    assert.equal(references[0]![0]!.scope, "external-snapshot"); assert.equal(references[0]![0]!.path, "external.txt");
    await addFiles(await file("large-external.txt", "x".repeat(1024 * 1024 + 1), true));
    assert.equal(references.length, 1); assert.match(JSON.stringify(dialogs.warnings), /1 MiB/);
  });
  test("binary files are never embedded in a chat reference", async () => {
    await addFiles(await file("binary.dat", Buffer.from([0, 1, 2]))); assert.equal(references.length, 0);
    assert.match(JSON.stringify(dialogs.warnings), /binary/);
  });
  for (const accept of [false, true]) {
    test(`sensitive files require explicit snapshot approval, accept=${accept}`, async () => {
      dialogs.warning = accept ? "Add snapshot" : undefined;
      await addFiles(await file(".env", "SECRET_TEST_VALUE"));
      assert.equal(references.length, accept ? 1 : 0);
      if (accept) { assert.equal(references[0]![0]!.scope, "external-snapshot"); assert.equal(references[0]![0]!.path, ".env"); }
    });
  }
  test("a file outside any workspace remains a read-only snapshot", async () => {
    workspace.workspaceFolders = undefined; await addFiles(await file("standalone", "text", true));
    assert.equal(references[0]![0]!.scope, "external-snapshot"); assert.equal(references[0]![0]!.language, "");
  });
  for (const selected of [undefined, "", "   ", "x".repeat(1024 * 1024 + 1)]) {
    test(`empty or oversized code selections are rejected, size=${selected?.length}`, async () => {
      if (selected !== undefined) { window.activeTextEditor = editor(await file("selection.ts"), selected, { empty: selected === "" }); }
      await commands.executeCommand("deepseek-agent.addSelectionToChat"); assert.equal(references.length, 0);
    });
  }
  for (const multiLine of [false, true]) {
    test(`selection references retain one-based ranges and language, multiLine=${multiLine}`, async () => {
      const uri = await file("selection.ts"); window.activeTextEditor = editor(uri, "selected code", { multiLine });
      await commands.executeCommand("deepseek-agent.addSelectionToChat");
      const reference = references[0]![0]!;
      assert.equal(reference.name, multiLine ? "selection.ts:3-6" : "selection.ts:3");
      assert.equal(reference.scope, "workspace"); assert.equal(reference.content, "selected code"); assert.equal(reference.language, "typescript");
      assert.deepEqual(reference.selection, { startLine: 3, startCharacter: 2, endLine: multiLine ? 6 : 3, endCharacter: 4 });
    });
  }
  for (const accept of [false, true]) {
    test(`external sensitive selections require explicit approval, accept=${accept}`, async () => {
      dialogs.warning = accept ? "Add snapshot" : undefined;
      window.activeTextEditor = editor(await file("credentials.key", "test", true), "selected secret");
      await commands.executeCommand("deepseek-agent.addSelectionToChat"); assert.equal(references.length, accept ? 1 : 0);
      if (accept) { assert.equal(references[0]![0]!.scope, "external-snapshot"); }
    });
  }
  test("reviewing without local workspace roots reports that a project is required", async () => {
    workspace.workspaceFolders = []; await commands.executeCommand("deepseek-agent.reviewChanges");
    assert.equal(references.length, 0); assert.match(JSON.stringify(dialogs.informationMessages), /Open a workspace/);
  });
  test("Git failures are surfaced without changing the chat draft", async () => {
    await commands.executeCommand("deepseek-agent.reviewChanges"); assert.deepEqual(drafts, []); assert.equal(dialogs.errors.length, 1);
  });
  test("a clean Git tree has nothing to review", async () => {
    await git("init", "-q"); await commands.executeCommand("deepseek-agent.reviewChanges");
    assert.equal(references.length, 0); assert.match(JSON.stringify(dialogs.informationMessages), /No Git changes/);
  });
  test("Git review combines staged and unstaged changes into a bounded diff snapshot", async () => {
    await git("init", "-q"); await file("tracked.txt", "before\n"); await git("add", ".");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--no-verify", "-qm", "Initial fixture");
    await file("tracked.txt", "staged\n"); await git("add", "tracked.txt"); await file("tracked.txt", "unstaged\n");
    await commands.executeCommand("deepseek-agent.reviewChanges");
    assert.deepEqual(drafts, ["Review these workspace changes."]); const reference = references[0]![0]!;
    assert.equal(reference.name, "git.diff"); assert.equal(reference.scope, "external-snapshot");
    assert.match(reference.content!, /Staged changes/); assert.match(reference.content!, /Unstaged changes/);
    assert.match(reference.content!, /staged/); assert.match(reference.content!, /unstaged/);
  });
  async function git(...args: string[]) { await execute("git", ["-C", project, ...args], { timeout: 10_000 }); }
});

function editor(uri: ReturnType<typeof Uri.file>, text: string, options: { empty?: boolean; multiLine?: boolean } = {}) {
  return {
    document: { uri, languageId: "typescript", isUntitled: false, lineCount: text.split("\n").length,
      getText: () => text, offsetAt: (position: { line: number; character: number }) => position.line * 10 + position.character,
      positionAt: (offset: number) => ({ line: Math.floor(offset / 10), character: offset % 10 }) },
    selection: { isEmpty: options.empty ?? false, start: { line: 2, character: 1 }, end: { line: options.multiLine ? 5 : 2, character: 3 } },
  };
}

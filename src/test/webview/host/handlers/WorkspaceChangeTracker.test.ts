import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { WorkspaceChangeTracker, revertWorkspaceTurn, snapshotRoots } from "@/vscode/workspace/WorkspaceChangeTracker";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot } from "@/vscode/workspace";
import { dialogs, resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("workspace change tracking lifecycle", () => {
  let root: string; let project: string; let data: string; let oldMode: string | undefined; let oldData: string | undefined;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "change-tracker-")); project = path.join(root, "project"); data = path.join(root, "data");
    await mkdir(project); await writeFile(path.join(project, "file.txt"), "Original");
    oldMode = process.env.NODE_ENV; oldData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = data;
    workspace.workspaceFolders = [{ name: "Project", uri: Uri.file(project) }];
  });
  teardown(async () => {
    resetVsCodeMock();
    if (oldMode === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = oldMode; }
    if (oldData === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; } else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = oldData; }
    await rm(root, { recursive: true, force: true });
  });
  const snapshot = () => captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding());
  async function persistedTurn() {
    await mkdir(path.join(data, "history", "chat"), { recursive: true });
    await writeFile(path.join(data, "history", "chat", "manifest.json"), "{}");
    const current = snapshot();
    const tracking = await new WorkspaceChangeTracker().begin("chat", "turn", false, current);
    assert.equal(tracking.notice, "");
    await writeFile(path.join(project, "file.txt"), "Agent change");
    await tracking.finish();
    return current;
  }
  test("reverts a completed turn using the default idle check", async () => {
    const current = await persistedTurn();
    assert.match(await revertWorkspaceTurn("chat", current), /Reverted turn turn: restored 1 changed paths/);
    assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "Original");
  });
  for (const guard of ["trust", "dirty", "busy"] as const) {
    test(`preserves current files when the ${guard} revert guard rejects`, async () => {
      const current = await persistedTurn();
      workspace.isTrusted = guard !== "trust";
      if (guard === "dirty") {
        workspace.textDocuments = [{ uri: Uri.file(path.join(project, "file.txt")), isDirty: true, getText: () => "Unsaved" }];
      }
      await assert.rejects(revertWorkspaceTurn("chat", current, "turn", () => {
        if (guard === "busy") { throw new Error("Generation still running"); }
      }), guard === "trust" ? /Trust the workspace/ : guard === "dirty" ? /Save or discard unsaved edits/ : /Generation still running/);
      assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "Agent change");
      workspace.isTrusted = true; workspace.textDocuments = [];
      await revertWorkspaceTurn("chat", current, "turn");
      assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "Original");
    });
  }
  test("reports non-Error failures from dirty document reads before and after a persistent turn", async () => {
    await mkdir(path.join(data, "history", "chat"), { recursive: true });
    await writeFile(path.join(data, "history", "chat", "manifest.json"), "{}");
    const current = snapshot();
    const document = { uri: Uri.file(path.join(project, "file.txt")), isDirty: true, getText: (): string => { throw "buffer unavailable"; } };
    workspace.textDocuments = [document];
    const failed = await new WorkspaceChangeTracker().begin("chat", "first", false, current);
    assert.match(failed.notice, /could not be checked/);
    assert.match(String(dialogs.warnings.at(-1)?.[0]), /buffer unavailable/);
    workspace.textDocuments = [];
    const tracking = await new WorkspaceChangeTracker().begin("chat", "second", false, current);
    assert.equal(tracking.notice, ""); workspace.textDocuments = [document];
    await tracking.finish();
    assert.match(String(dialogs.warnings.at(-1)?.[0]), /recovery copy could not be completed.*buffer unavailable/);
    assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "Original");
  });
  test("bounds incognito history to the most recent hundred conversations", async () => {
    const tracker = new WorkspaceChangeTracker(); const current = snapshot();
    for (let i = 0; i < 101; i++) { await tracker.begin(`chat-${i}`, `turn-${i}`, true, current); }
    await writeFile(path.join(project, "file.txt"), "Changed");
    assert.equal((await tracker.begin("chat-0", "evicted", true, current)).notice, "");
    assert.match((await tracker.begin("chat-100", "retained", true, current)).notice, /file\.txt/);
    assert.equal(dialogs.warnings.length, 0);
  });
  test("tracks authoritative dirty text without saving it and refreshes the memory snapshot on finish", async () => {
    const tracker = new WorkspaceChangeTracker(); let content = "Unsaved one";
    workspace.textDocuments = [{ uri: Uri.file(path.join(project, "file.txt")), isDirty: true, getText: () => content }];
    const current = snapshot(); const first = await tracker.begin("chat", "first", true, current); assert.equal(first.notice, "");
    content = "Unsaved two"; const next = await tracker.begin("chat", "next", true, current); assert.match(next.notice, /file\.txt/);
    await next.finish(); assert.equal((await tracker.begin("chat", "third", true, current)).notice, "");
    assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "Original");
  });
  for (const incognito of [false, true]) {
    test(`reports remote snapshot limitations without blocking the turn, incognito=${incognito}`, async () => {
      workspace.workspaceFolders = [{ name: "Remote", uri: Uri.parse("vscode-remote://host/project") }];
      const current = snapshot(); assert.throws(() => snapshotRoots(current), /local filesystem access/);
      const tracking = await new WorkspaceChangeTracker().begin("chat", "turn", incognito, current);
      assert.match(tracking.notice, /could not be checked/); await tracking.finish();
      assert.equal(dialogs.warnings.length, incognito ? 0 : 1);
    });
  }
  test("reports a persistent finish failure while preserving the live workspace", async () => {
    await mkdir(path.join(data, "history", "chat"), { recursive: true });
    await writeFile(path.join(data, "history", "chat", "manifest.json"), "{}");
    const tracking = await new WorkspaceChangeTracker().begin("chat", "turn", false, snapshot());
    await writeFile(path.join(data, "snapshoots/chat/.snapshot/turns/turn/turn.json"), "{invalid");
    await tracking.finish(); assert.match(String(dialogs.warnings.at(-1)?.[0]), /recovery copy could not be completed/);
    assert.equal(await readFile(path.join(project, "file.txt"), "utf8"), "Original");
  });
});

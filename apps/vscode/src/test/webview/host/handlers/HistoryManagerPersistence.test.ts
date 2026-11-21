import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { SettingsRepository } from "@/application/ports";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import { DEFAULT_CONFIG } from "@/contracts";
import { HistoryManager } from "@/vscode/storage/HistoryManager";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import { resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("history manager deletion and retention", () => {
  let root: string;
  let history: HistoryManager;
  let settings: { historyEnabled: boolean; retentionDays: number };
  let previousMode: string | undefined;
  let previousDirectory: string | undefined;

  setup(async () => {
    resetVsCodeMock();
    root = await mkdtemp(path.join(tmpdir(), "history-retention-"));
    previousMode = process.env.NODE_ENV;
    previousDirectory = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test";
    process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(root, "data");
    const folder = path.join(root, "workspace");
    await mkdir(folder, { recursive: true });
    workspace.workspaceFolders = [{ uri: Uri.file(folder), name: "workspace" }];
    settings = { historyEnabled: true, retentionDays: 30 };
    history = new HistoryManager({
      load: () => ({ ...DEFAULT_CONFIG, historyEnabled: settings.historyEnabled, historyRetentionDays: settings.retentionDays }),
    } as SettingsRepository);
    await history.initialize();
  });

  teardown(async () => {
    resetVsCodeMock();
    for (const [name, value] of [["NODE_ENV", previousMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", previousDirectory]] as Array<[string, string | undefined]>) {
      if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
    }
    await rm(root, { recursive: true, force: true });
  });

  function conversation(id: string, updatedAt = 10): StoredConversation {
    const binding = captureCurrentWorkspaceBinding();
    return {
      schemaVersion: 2, id, title: id, createdAt: 1, updatedAt, model: DEFAULT_CONFIG.model,
      workspaceUri: binding.uri, workspaceBinding: binding, messages: [],
    };
  }

  test("deletes a single conversation and tolerates missing identifiers", async () => {
    await history.save(conversation("keep"));
    assert.equal(await history.delete("keep"), true);
    assert.equal(await history.getById("keep"), undefined);
    assert.equal(await history.delete("keep"), true);
  });

  test("deduplicates bulk deletion and honours the expected revision", async () => {
    await history.save(conversation("first", 10));
    await history.save(conversation("second", 20));
    assert.deepEqual(await history.deleteMany(["first", "first", { id: "second", expectedUpdatedAt: 21 }]), ["first"]);
    assert.equal(await history.getById("second") !== undefined, true);
    assert.deepEqual(await history.deleteMany([{ id: "second", expectedUpdatedAt: 20 }, "missing"]), ["second", "missing"]);
    assert.deepEqual(await history.deleteMany([{ id: "first" }]), ["first"]);
  });

  test("writes a conversation only while it is absent", async () => {
    assert.equal(await history.saveIfAbsent(conversation("draft")), true);
    assert.equal(await history.saveIfAbsent(conversation("draft", 99)), false);
    assert.equal((await history.getById("draft"))?.updatedAt, 10);
    await assert.rejects(history.saveIfAbsent({ id: "invalid" } as StoredConversation), /Refusing to persist an incompatible conversation/);
  });

  test("refuses to overwrite a newer copy written by another window", async () => {
    await history.save(conversation("shared", 30));
    await assert.rejects(history.save(conversation("shared", 20)), /Conversation changed in another VS Code window/);
    await assert.rejects(history.save({ ...conversation("shared", 30), title: "edited" }), /Conversation changed in another VS Code window/);
    await history.save({ ...conversation("shared", 40), title: "newer" });
    assert.equal((await history.getById("shared"))?.title, "newer");
  });

  test("drops expired conversations and keeps the ones inside the retention window", async () => {
    await history.save(conversation("expired", Date.now() - 90 * 86_400_000));
    await history.save(conversation("fresh", Date.now()));
    const summaries = await history.getSummaries();
    assert.deepEqual(summaries.map((summary) => summary.id), ["fresh"]);
    assert.equal(await history.getById("expired"), undefined);

    settings.retentionDays = 0;
    await history.save(conversation("unbounded", Date.now() - 900 * 86_400_000));
    assert.deepEqual((await history.getSummaries()).map((summary) => summary.id), ["fresh", "unbounded"]);
  });

  test("stays inert while persistent history is disabled", async () => {
    settings.historyEnabled = false;
    await history.save(conversation("ignored"));
    assert.equal(await history.getById("ignored"), undefined);
    assert.deepEqual(await history.getSummaries(), []);
    assert.deepEqual(await history.deleteMany(["ignored"]), []);
    assert.equal(await history.delete("ignored"), false);
    assert.equal(await history.saveIfAbsent(conversation("ignored")), false);
  });
});

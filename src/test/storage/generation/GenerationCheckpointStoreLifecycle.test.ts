import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SettingsRepository } from "@/application/ports";
import {
  getGenerationCheckpointPath,
  getHistoryDirectory,
  getLegacyGenerationCheckpointDirectory,
} from "@/infrastructure/persistence/UserDataPaths";
import { GenerationCheckpointStore } from "@/vscode/storage/GenerationCheckpointStore";

const binding = {
  schemaVersion: 1, uri: "file:///workspace", name: "workspace", revision: "r1", folders: [],
  capabilities: { files: true, search: true, git: true, terminal: true },
};

type CheckpointInput = Parameters<GenerationCheckpointStore["save"]>[0];

function checkpoint(conversationId: string, overrides: Record<string, unknown> = {}): CheckpointInput {
  return {
    conversationId, status: "streaming", content: "partial", timeline: [], toolCalls: [], queue: [],
    updatedAt: 42, workspaceUri: "file:///workspace", workspaceBinding: binding, ...overrides,
  } as CheckpointInput;
}

suite("generation checkpoint store lifecycle", () => {
  let root: string;
  let previousMode: string | undefined;
  let previousDirectory: string | undefined;
  let enabled: boolean;
  let store: GenerationCheckpointStore;

  const settings = { load: () => ({ historyEnabled: enabled }) } as unknown as SettingsRepository;

  setup(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "checkpoint-lifecycle-"));
    previousMode = process.env.NODE_ENV;
    previousDirectory = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test";
    process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
    enabled = true;
    store = new GenerationCheckpointStore(settings);
  });

  teardown(async () => {
    for (const [name, value] of [["NODE_ENV", previousMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", previousDirectory]] as Array<[string, string | undefined]>) {
      if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
    }
    await rm(root, { recursive: true, force: true });
  });

  test("increments revisions and skips writes while history is disabled", async () => {
    const first = await store.save(checkpoint("chat"));
    assert.equal(first.revision, 1);
    const second = await store.save(checkpoint("chat", { content: "latest" }));
    assert.equal(second.revision, 2);
    await store.flush();
    const stored = JSON.parse(await readFile(getGenerationCheckpointPath("chat"), "utf8")) as { content: string; revision: number };
    assert.deepEqual([stored.revision, stored.content], [2, "latest"]);

    enabled = false;
    const skipped = await store.save(checkpoint("chat", { content: "kept in memory" }));
    assert.equal(skipped.revision, 3);
    await store.flush();
    assert.equal((JSON.parse(await readFile(getGenerationCheckpointPath("chat"), "utf8")) as { content: string }).content, "latest");
  });

  test("compacts oversized checkpoints before writing them", async () => {
    const saved = await store.save(checkpoint("large", {
      content: "c",
      timeline: [
        { type: "content", content: "x".repeat(20 * 1024 * 1024) },
        { type: "reasoning", content: "y".repeat(600 * 1024) },
      ],
      toolCalls: [{ id: "call", name: "read_file", arguments: "{\"path\":\"a\"}", result: "done", status: "completed" },
        { id: "pending", name: "list_directory", arguments: "{}", status: "pending" }],
      queue: [{ clientRequestId: "queued", text: "later", queuedAt: 1 }],
    }));
    assert.equal(saved.timeline.length, 1);
    assert.equal(saved.timeline[0]!.type, "reasoning");
    const reasoning = saved.timeline[0] as { content: string };
    assert.ok(reasoning.content.length < 600 * 1024);
    await store.flush();
    assert.equal(existsSync(getGenerationCheckpointPath("large")), true);
  });

  test("rejects checkpoints that stay oversized after compaction", async () => {
    await assert.rejects(
      store.save(checkpoint("huge", { content: "z".repeat(17 * 1024 * 1024) })),
      /exceeded its 16 MiB persistence limit after compaction/,
    );
  });

  test("removes the legacy checkpoint file for a conversation", async () => {
    const legacy = getLegacyGenerationCheckpointDirectory();
    await mkdir(legacy, { recursive: true });
    const legacyFile = path.join(legacy, "chat_one.json");
    await writeFile(legacyFile, "{}");
    await store.save(checkpoint("chat one"));
    await store.delete("chat one");
    assert.equal(existsSync(getGenerationCheckpointPath("chat one")), false);
    assert.equal(existsSync(legacyFile), false);
    assert.equal(existsSync(legacy), true);
  });

  test("clears persisted checkpoints and the legacy directory contents", async () => {
    await store.save(checkpoint("first"));
    await store.save(checkpoint("second"));
    const legacy = getLegacyGenerationCheckpointDirectory();
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "first.json"), "{}");
    await writeFile(path.join(legacy, "notes.txt"), "keep me");

    await store.clearAll();

    assert.equal(existsSync(getGenerationCheckpointPath("first")), false);
    assert.equal(existsSync(getGenerationCheckpointPath("second")), false);
    assert.deepEqual(await readdir(legacy), ["notes.txt"]);
  });

  test("recovers only well-formed checkpoints and deletes the rest", async () => {
    const good = await store.save(checkpoint("good"));
    await store.flush();
    const history = getHistoryDirectory();
    await mkdir(path.join(history, "broken-json"), { recursive: true });
    await writeFile(path.join(history, "broken-json", "checkpoint.json"), "not json");
    await mkdir(path.join(history, "wrong-id"), { recursive: true });
    await writeFile(path.join(history, "wrong-id", "checkpoint.json"), JSON.stringify({ ...good, conversationId: "other" }));
    await mkdir(path.join(history, "invalid-snapshot"), { recursive: true });
    await writeFile(path.join(history, "invalid-snapshot", "checkpoint.json"), JSON.stringify({
      ...good, conversationId: "invalid-snapshot", permissionSnapshot: { revision: "1", workspaceTrusted: true },
    }));
    await mkdir(path.join(history, "missing-file"), { recursive: true });
    const linkTarget = path.join(history, "link-target.json");
    await writeFile(linkTarget, JSON.stringify({ ...good, conversationId: "linked" }));
    await mkdir(path.join(history, "linked"), { recursive: true });
    await symlink(linkTarget, path.join(history, "linked", "checkpoint.json"));
    await mkdir(path.join(history, ".hidden"), { recursive: true });
    await mkdir(path.join(history, "new-chat-draft"), { recursive: true });

    const recovered = await new GenerationCheckpointStore(settings).recover();

    assert.deepEqual(recovered.map((entry) => entry.conversationId), ["good"]);
    assert.equal(existsSync(path.join(history, "broken-json")), true);
    assert.equal(existsSync(path.join(history, "broken-json", "checkpoint.json")), false);
    assert.equal(existsSync(path.join(history, "wrong-id", "checkpoint.json")), false);
    assert.equal(existsSync(path.join(history, "invalid-snapshot", "checkpoint.json")), false);
    assert.equal(existsSync(path.join(history, "linked", "checkpoint.json")), false);
  });

  test("refuses checkpoint storage that points at a file", async () => {
    const redirected = await mkdtemp(path.join(os.tmpdir(), "checkpoint-redirected-"));
    try {
      process.env.DEEPSEEK_AGENT_USER_DATA_DIR = redirected;
      await writeFile(getHistoryDirectory(), "not a directory");
      const redirectedStore = new GenerationCheckpointStore(settings);
      await assert.rejects(redirectedStore.save(checkpoint("chat")), /cannot use redirected directories/);
      await assert.rejects(redirectedStore.clearAll(), /cannot use redirected directories/);
    } finally {
      process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
      await rm(redirected, { recursive: true, force: true });
    }
  });
});

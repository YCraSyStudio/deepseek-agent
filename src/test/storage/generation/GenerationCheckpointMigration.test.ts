import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateGenerationCheckpoints } from "@/infrastructure/persistence/UserDataMigration";
import { getGenerationCheckpointPath, getLegacyGenerationCheckpointDirectory, getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { GenerationCheckpointStore } from "@/vscode/storage/GenerationCheckpointStore";
import { readStoredConversationRecord } from "@/vscode/storage/ConversationStorage";
import type { SettingsRepository } from "@/application/ports";

suite("checkpoint migration to conversation storage", () => {
  let root: string;
  let previousEnv: string | undefined;
  let previousRoot: string | undefined;
  const settings = { load: () => ({ historyEnabled: true }) } as unknown as SettingsRepository;
  const checkpoint = (conversationId: string) => ({ schemaVersion: 3, revision: 2, conversationId,
    status: "streaming", content: "partial answer", timeline: [], toolCalls: [], queue: [], updatedAt: 42,
    workspaceUri: "file:///workspace", workspaceBinding: { schemaVersion: 1, uri: "file:///workspace", name: "workspace", revision: "r1", folders: [],
      capabilities: { files: true, search: true, git: true, terminal: true } } });
  setup(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "deepseek-checkpoint-migration-"));
    previousEnv = process.env.NODE_ENV;previousRoot = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test";process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root;
  });
  teardown(async () => {
    if (previousEnv === undefined) {delete process.env.NODE_ENV;} else {process.env.NODE_ENV = previousEnv;}
    if (previousRoot === undefined) {delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR;} else {process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousRoot;}
    await rm(root, { recursive: true, force: true });
  });
  test("migrates once, removes the empty legacy directory and retains recovery without a history manifest", async () => {
    const legacy = getLegacyGenerationCheckpointDirectory();await mkdir(legacy);
    const value = checkpoint("chat-one");await writeFile(path.join(legacy, "chat-one.json"), JSON.stringify(value));
    await Promise.all([migrateGenerationCheckpoints(), migrateGenerationCheckpoints()]);
    assert.equal(existsSync(legacy), false);
    assert.deepEqual(JSON.parse(await readFile(getGenerationCheckpointPath("chat-one"), "utf8")), value);
    assert.equal(await readStoredConversationRecord(path.join(getHistoryDirectory(), "chat-one")), undefined);
    const store = new GenerationCheckpointStore(settings);
    assert.deepEqual((await store.recover()).map(record => record.content), ["partial answer"]);
    await migrateGenerationCheckpoints();
    assert.equal(existsSync(legacy), false);
    await store.delete("chat-one");
    assert.equal(existsSync(getGenerationCheckpointPath("chat-one")), false);
  });
  test("resumes after a copied checkpoint and preserves conflicting destinations", async () => {
    const legacy = getLegacyGenerationCheckpointDirectory();await mkdir(legacy);
    const target = getGenerationCheckpointPath("chat-one");await mkdir(path.dirname(target), { recursive: true });
    const value = checkpoint("chat-one");
    await writeFile(path.join(legacy, "chat-one.json"), JSON.stringify(value));await writeFile(target, JSON.stringify({ ...value, content: "newer answer" }));
    await assert.rejects(migrateGenerationCheckpoints(), /conflict/);
    assert.equal(JSON.parse(await readFile(target, "utf8")).content, "newer answer");
    assert.equal(existsSync(path.join(legacy, "chat-one.json")), true);
    await writeFile(target, JSON.stringify(value));await migrateGenerationCheckpoints();
    assert.equal(existsSync(legacy), false);
  });
  test("does not remove unrelated legacy files or follow redirected destinations", async () => {
    const legacy = getLegacyGenerationCheckpointDirectory();await mkdir(legacy);
    await writeFile(path.join(legacy, "keep.txt"), "user data");await migrateGenerationCheckpoints();
    assert.deepEqual(await readdir(legacy), ["keep.txt"]);
    const outside = path.join(root, "outside");await mkdir(outside);
    await mkdir(getHistoryDirectory(), { recursive: true });await symlink(outside, path.dirname(getGenerationCheckpointPath("chat-one")));
    await writeFile(path.join(legacy, "chat-one.json"), JSON.stringify(checkpoint("chat-one")));
    await assert.rejects(migrateGenerationCheckpoints(), /redirected/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(existsSync(path.join(legacy, "chat-one.json")), true);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { isConversation } from "@/application/chat/ConversationValidation";
import * as os from "node:os";
import * as path from "node:path";
import { ConversationState } from "@/application/chat/ConversationState";
import { getHistoryDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { deleteConversationStorage, purgeLegacyConversationStorage, readConversationFile, readStoredConversationRecord, writeConversationStorage } from "@/vscode/storage/ConversationStorage";
import { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";

suite("conversation storage round trip", () => {
  test("retains a new user message and its assistant reply on disk", async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousDirectory = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    const directory = await mkdtemp(path.join(os.tmpdir(), "deepseek-history-test-"));
    process.env.NODE_ENV = "test";
    process.env.DEEPSEEK_AGENT_USER_DATA_DIR = directory;
    try {
      const state = new ConversationState({ save: writeConversationStorage });
      await state.saveMessages({ messages: [state.createMessage("user", "hola")], model: "deepseek-chat" });
      const id = state.getActiveConversationId()!;
      const storedDirectory = path.join(getHistoryDirectory(), encodeURIComponent(id));
      const manifest = JSON.parse(await readFile(path.join(storedDirectory, "manifest.json"), "utf8"));
      const chunk = JSON.parse(await readFile(path.join(storedDirectory, "0.json"), "utf8"));
      assert.equal(isConversation({ ...manifest.conversation, messages: chunk }), true);
      assert.equal((await readConversationFile(id))?.messages[0].content, "hola");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
      const screenshots = new ScreenshotStore(id);
      const capture = await screenshots.save(png, { kind: "web", target: "http://localhost:3000" });
      await purgeLegacyConversationStorage();
      const reply = state.createMessage("assistant", "Hola", {
        contextContent: "Hola",
        timeline: [{ id: "reasoning", type: "reasoning", content: "Pensando" }, { id: "final", type: "content", content: "Hola" }],
      });
      await state.saveMessages({ messages: [reply], model: "deepseek-chat" });
      const record = await readStoredConversationRecord(path.join(getHistoryDirectory(), encodeURIComponent(id)));
      assert.deepEqual(record?.conversation.messages.map((message) => message.content), ["hola", "Hola"]);
      assert.equal((await readdir(getHistoryDirectory())).length, 1);
      const storedText = await readFile(path.join(storedDirectory, "0.json"), "utf8");
      const compact = JSON.parse(storedText)[1];
      assert.equal(compact.contextContent, undefined);
      assert.deepEqual(compact.timeline[1], { id: "final", type: "content", contentRef: "message" });
      assert.deepEqual(record?.conversation.messages[1].timeline, reply.timeline);
      assert.equal(record?.sizeBytes, (await stat(path.join(storedDirectory, "manifest.json"))).size + Buffer.byteLength(storedText));
      // Existing schema-1 expanded chunks remain readable after upgrading.
      const legacyManifest = JSON.parse(await readFile(path.join(storedDirectory, "manifest.json"), "utf8"));
      legacyManifest.storageSchemaVersion = 1;
      await writeFile(path.join(storedDirectory, "manifest.json"), JSON.stringify(legacyManifest));
      await writeFile(path.join(storedDirectory, "0.json"), JSON.stringify(record!.conversation.messages));
      const legacy = await readConversationFile(id);
      assert.deepEqual(legacy?.messages[1].timeline, reply.timeline);
      await writeConversationStorage(legacy!);
      assert.equal(JSON.parse(await readFile(path.join(storedDirectory, "manifest.json"), "utf8")).storageSchemaVersion, 2);
      assert.deepEqual((await screenshots.lookup(capture.id))?.bytes, png);
      await deleteConversationStorage(id);
      assert.equal(await screenshots.lookup("latest"), undefined);
      assert.equal((await readdir(getHistoryDirectory())).length, 0);
    } finally {
      if (previousEnv === undefined) {delete process.env.NODE_ENV;} else {process.env.NODE_ENV = previousEnv;}
      if (previousDirectory === undefined) {delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR;} else {process.env.DEEPSEEK_AGENT_USER_DATA_DIR = previousDirectory;}
      await rm(directory, { recursive: true, force: true });
    }
  });
});

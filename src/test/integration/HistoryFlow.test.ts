import assert from "node:assert/strict";
import { HistoryTransitionController } from "@/vscode/webviews/handlers/HistoryTransitionController";
import { ChatE2e, type PostedMessage } from "./support/ChatE2e";

const PRIVATE_QUESTION = "Explain the draft in this incognito chat";

suite("History flow", () => {
  let chat: ChatE2e | undefined;

  teardown(async () => {
    await chat?.dispose();
    chat = undefined;
  });

  test("keeps incognito work out of history until the user saves it", async () => {
    chat = await ChatE2e.create();
    const results: Array<{ requestId: string; status: string }> = [];
    const controller = new HistoryTransitionController({
      chatHandler: chat.handler,
      settings: chat.settings,
      postUpdateResult: async (_view, requestId, _operation, status) => {
        results.push({ requestId, status });
      },
    });

    await controller.request({
      requestId: "enter-1",
      operation: "save",
      targetEnabled: false,
      config: { historyEnabled: false },
      webviewView: chat.view,
    });

    assert.equal(chat.settings.load().historyEnabled, false);
    assert.deepEqual(results, [{ requestId: "enter-1", status: "success" }]);
    assert.equal(lastPost(chat.posts, "configLoaded")?.type, "configLoaded");

    chat.transport.respond({ text: "Incognito answer." });
    const generationId = await chat.runTurn(PRIVATE_QUESTION);
    assert.equal((await chat.waitForTerminal(generationId)).status, "completed");
    assert.deepEqual(await chat.history.getSummaries(), [], "incognito work must not be listed in history");

    await controller.request({
      requestId: "exit-1",
      operation: "save",
      targetEnabled: true,
      config: { historyEnabled: true },
      webviewView: chat.view,
    });
    const required = lastPost(chat.posts, "historyTransitionRequired");
    assert.equal(required?.phase, "exit-incognito");
    assert.equal(required?.direction, "exit-incognito");
    assert.equal(chat.settings.load().historyEnabled, false, "history stays off until the decision is applied");

    await controller.resolve("exit-1", "save", chat.view);

    assert.equal(chat.settings.load().historyEnabled, true);
    assert.deepEqual(results.map((result) => result.status), ["success", "success"]);
    const summaries = await chat.history.getSummaries();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.id, chat.conversationIdFor(generationId));
    const stored = await chat.history.getById(summaries[0]!.id);
    assert.equal(
      stored?.messages.find((message) => message.role === "user")?.content,
      PRIVATE_QUESTION,
    );
  });

  test("discards incognito work instead of promoting it", async () => {
    chat = await ChatE2e.create();
    const results: string[] = [];
    const controller = new HistoryTransitionController({
      chatHandler: chat.handler,
      settings: chat.settings,
      postUpdateResult: async (_view, _requestId, _operation, status) => {
        results.push(status);
      },
    });

    await controller.request({
      requestId: "enter-1",
      operation: "save",
      targetEnabled: false,
      config: { historyEnabled: false },
      webviewView: chat.view,
    });
    chat.transport.respond({ text: "Temporary answer." });
    const generationId = await chat.runTurn("Temporary question");
    const conversationId = chat.conversationIdFor(generationId);
    assert.ok(conversationId);

    await controller.request({
      requestId: "exit-1",
      operation: "save",
      targetEnabled: true,
      config: { historyEnabled: true },
      webviewView: chat.view,
    });
    await controller.resolve("exit-1", "discard", chat.view);

    assert.equal(chat.settings.load().historyEnabled, true);
    assert.deepEqual(results, ["success", "success"]);
    assert.deepEqual(await chat.history.getSummaries(), []);
    assert.equal(await chat.history.getById(conversationId), undefined);
  });
});

function lastPost(posts: readonly PostedMessage[], type: string): PostedMessage | undefined {
  return [...posts].reverse().find((post) => post.type === type);
}

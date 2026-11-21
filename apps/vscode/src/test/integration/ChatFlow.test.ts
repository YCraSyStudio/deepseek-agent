import assert from "node:assert/strict";
import { ChatE2e } from "./support/ChatE2e";

suite("Chat flow", () => {
  let chat: ChatE2e | undefined;

  teardown(async () => {
    await chat?.dispose();
    chat = undefined;
  });

  test("streams a model answer and persists the completed turn", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ text: "The endpoint is ready." });

    const generationId = await chat.runTurn("Describe the endpoint");
    const terminal = await chat.waitForTerminal(generationId);

    assert.equal(terminal.type, "streamDone");
    assert.equal(terminal.status, "completed");
    assert.equal(chat.transport.remaining, 0, "every scripted provider round must be consumed");
    assert.match(
      chat.messagesOfType("streamTimelineDelta").map((post) => String(post.content)).join(""),
      /The endpoint is ready\./,
    );

    const conversationId = chat.conversationIdFor(generationId);
    assert.ok(conversationId);
    const stored = await chat.history.getById(conversationId);
    assert.ok(stored, "the completed turn must be persisted");
    assert.equal(stored.messages.find((message) => message.role === "user")?.content, "Describe the endpoint");
    assert.match(
      stored.messages.find((message) => message.role === "assistant")?.content ?? "",
      /The endpoint is ready\./,
    );
  });

  test("rejects a stale workspace revision before contacting the provider", async () => {
    chat = await ChatE2e.create();

    chat.send("Continue", { workspaceRevision: "stale-revision" });
    const rejected = await chat.waitForPost("requestRejected");

    assert.match(String(rejected.error), /workspace changed/i);
    assert.equal(chat.transport.requests.length, 0);
    assert.deepEqual(chat.generationIds(), []);
  });

  test("rejects a conversation that no longer exists without inheriting another chat", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ text: "Never sent." });

    chat.send("Continue", { conversationId: "deleted-conversation" });
    const rejected = await chat.waitForPost("requestRejected");

    assert.match(String(rejected.error), /Conversation not found/);
    assert.deepEqual(chat.generationIds(), []);
  });

  test("queues a second message in the same conversation and runs it after the first", async () => {
    chat = await ChatE2e.create();
    chat.transport
      .respond({ text: "First answer.", delayedMs: 1_200 })
      .respond({ text: "Second answer." });

    const firstGeneration = await chat.startTurn("First question");
    const conversationId = chat.conversationIdFor(firstGeneration);
    assert.ok(conversationId);

    chat.send("Second question", { conversationId });
    const queued = await chat.waitForPost("messageQueued");
    assert.equal(queued.conversationId, conversationId);
    assert.equal(queued.position, 1);

    await chat.waitForTerminal(firstGeneration);
    await chat.waitFor(
      () => chat!.messagesOfType("streamDone").length === 2,
      "both queued generations to finish",
    );

    const stored = await chat.history.getById(conversationId);
    assert.ok(stored);
    assert.deepEqual(
      stored.messages.filter((message) => message.role === "user").map((message) => message.content),
      ["First question", "Second question"],
    );
    assert.deepEqual(
      chat.messagesOfType("generationActivityChanged")
        .filter((post) => post.conversationId === conversationId)
        .map((post) => post.status),
      ["queued", "running", "queued", "settled", "running", "settled"],
    );
  });

  test("cancels an in-flight answer and persists one terminal cancelled turn", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ text: "Partial answer.", delayedMs: 5_000 });

    const generationId = await chat.startTurn("Take your time");
    await chat.waitFor(
      () => chat!.messagesOfType("streamTimelineDelta").length > 0,
      "the first streamed content",
    );
    await chat.cancel(generationId);
    const accepted = await chat.waitForPostMatching(
      "cancelGenerationResult",
      (post) => post.generationId === generationId,
    );
    assert.equal(accepted.status, "accepted", JSON.stringify(accepted));

    const terminal = await chat.waitForTerminal(generationId);
    assert.equal(terminal.type, "streamDone");
    assert.equal(terminal.status, "cancelled", JSON.stringify(terminal));
    assert.equal(terminal.generationStopReason, "user_cancelled");

    const conversationId = chat.conversationIdFor(generationId);
    assert.ok(conversationId);
    const stored = await chat.history.getById(conversationId);
    const assistant = stored?.messages.find((message) => message.role === "assistant");
    assert.equal(assistant?.generationStatus, "cancelled");
    assert.match(assistant?.content ?? "", /Partial answer\./);
    assert.equal(
      chat.messagesOfType("streamDone").filter((post) => post.generationId === generationId).length,
      1,
      "cancellation must publish exactly one terminal event",
    );
  });

  test("passes a former slash command through to the model unchanged", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ text: "No local command ran." });

    await chat.runTurn("/status");

    const sent = chat.transport.lastUserMessage();
    assert.ok(sent?.startsWith("/status"), `the command must reach the model as text, got: ${sent ?? "<none>"}`);
    assert.equal(chat.transport.streamedRequests().length, 1);
  });

  test("starts an independent conversation when the composer is blank", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ text: "First." }).respond({ text: "Second." });

    const first = await chat.runTurn("First question");
    const second = await chat.runTurn("Second question");

    assert.notEqual(chat.conversationIdFor(first), chat.conversationIdFor(second));
    const stored = await chat.history.getById(chat.conversationIdFor(second)!);
    assert.deepEqual(
      stored?.messages.filter((message) => message.role === "user").map((message) => message.content),
      ["Second question"],
    );
  });

  test("normalizes a workspace reference before the request and rejects an escaping path", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ text: "Read it." });

    await chat.runTurn("Explain the manifest", {
      referencedFiles: [{ name: "package.json", path: "./package.json", type: "file" }],
    });
    const sent = chat.transport.lastUserMessage();
    assert.match(sent ?? "", /package\.json/);

    chat.send("Read outside", {
      referencedFiles: [{ name: "outside.ts", path: "../outside.ts", type: "file" }],
    });
    const rejected = await chat.waitForPost("requestRejected");
    assert.match(String(rejected.error), /workspace/i);
    assert.equal(chat.transport.streamedRequests().length, 1);
  });

  test("surfaces a provider failure once without a hidden retry", async () => {
    chat = await ChatE2e.create();
    chat.transport.respond({ failure: { status: 404, message: "Model not found", code: "model_not_found" } });

    const generationId = await chat.startTurn("Use the missing model");
    const terminal = await chat.waitForTerminal(generationId);

    assert.equal(terminal.type, "streamError");
    assert.match(String(terminal.error), /HTTP 404/);
    assert.equal(
      chat.transport.streamedRequests().length,
      1,
      "a chat request must not be retried behind the user's back",
    );

    const stored = await chat.history.getById(chat.conversationIdFor(generationId)!);
    assert.ok(
      stored?.messages.some((message) => message.role === "error"),
      "the failure must stay visible in the conversation",
    );
  });
});

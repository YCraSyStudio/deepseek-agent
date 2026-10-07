import * as assert from "assert";
import type { AssistantTimelineEvent, Conversation, ImageAttachment } from "@/contracts";
import { ConversationState } from "@/application/chat/ConversationState";
import { createProviderTranscript } from "@/application/chat/ProviderTranscript";

suite("ConversationState", () => {
  test("persists archive-assigned image numbers without duplicating the user message", async () => {
    const saves: Conversation[] = [];
    const state = new ConversationState({ save: async (conversation) => {saves.push(structuredClone(conversation));} });
    const attachment: ImageAttachment = {
      id: "attachment", fileId: "file-api-test", name: "image.png", mediaType: "image/png", size: 1,
      source: "clipboard", uploadedAt: 1, expiresAt: Date.now() + 60_000,
      apiBaseUrl: "https://api.deepseek.com", cacheFileName: "image.png",
    };
    const message = state.createMessage("user", "Compare images 1 and 3", { imageAttachments: [attachment] });
    await state.saveMessages({ messages: [message], model: "test-model" });
    attachment.imageNumber = 4;
    await state.updateMessageAttachments(message.id, [attachment]);
    assert.strictEqual(saves[0].messages[0].imageAttachments?.[0].imageNumber, undefined);
    assert.strictEqual(saves[1].messages.length, 1);
    const restored = new ConversationState({ save: async () => undefined });
    restored.load(saves[1]);
    assert.strictEqual(restored.getConversation()?.messages[0].imageAttachments?.[0].imageNumber, 4);
    attachment.imageNumber = 99;
    assert.strictEqual(state.getConversation()?.messages[0].imageAttachments?.[0].imageNumber, 4);
  });
  test("keeps incognito turns in memory until an explicit promotion", async () => {
    const saves: Conversation[] = [];
    const state = new ConversationState(
      { save: async (conversation) => {saves.push(structuredClone(conversation));} },
      "incognito",
    );

    await state.saveTurn({
      userMessage: state.createMessage("user", "Private question"),
      assistantMessage: state.createMessage("assistant", "Private answer"),
      model: "test-model",
    });

    assert.strictEqual(state.isIncognito(), true);
    assert.strictEqual(state.hasMessages(), true);
    assert.strictEqual(state.getConversation()?.messages.length, 2);
    assert.strictEqual(saves.length, 0);

    await state.promoteIncognito();
    assert.strictEqual(state.getPersistenceMode(), "persistent");
    assert.strictEqual(saves.length, 1);
    assert.deepStrictEqual(saves[0].messages.map((message) => message.content), ["Private question", "Private answer"]);
  });

  test("discards an incognito conversation without touching the store", async () => {
    let saveCount = 0;
    const state = new ConversationState(
      { save: async () => {saveCount += 1;} },
      "incognito",
    );
    await state.saveMessages({ messages: [state.createMessage("user", "Secret")], model: "test-model" });

    state.reset("incognito");

    assert.strictEqual(saveCount, 0);
    assert.strictEqual(state.hasMessages(), false);
    assert.strictEqual(state.getConversation(), undefined);
  });

  test("appends multiple turns to one conversation until explicitly reset", async () => {
    const saves: Conversation[] = [];
    const state = new ConversationState({ save: async (conversation) => {saves.push(structuredClone(conversation));} });

    await state.saveTurn({
      userMessage: state.createMessage("user", "First"),
      assistantMessage: state.createMessage("assistant", "One"),
      model: "test-model",
    });
    const firstId = state.getActiveConversationId();
    await state.saveTurn({
      userMessage: state.createMessage("user", "Second"),
      assistantMessage: state.createMessage("assistant", "Two"),
      model: "test-model",
    });

    assert.strictEqual(saves.length, 2);
    assert.strictEqual(saves[1].id, firstId);
    assert.strictEqual(saves[1].messages.length, 4);

    state.reset();
    await state.saveTurn({
      userMessage: state.createMessage("user", "New chat"),
      assistantMessage: state.createMessage("assistant", "Separate"),
      model: "test-model",
    });
    assert.notStrictEqual(state.getActiveConversationId(), firstId);
  });

  test("persists timeline events but does not synthesize provider reasoning for legacy turns", async () => {
    let saved: Conversation | undefined;
    const state = new ConversationState({
      save: async (conversation) => {
        saved = conversation;
      },
    });
    const timeline: AssistantTimelineEvent[] = [
      { id: "reasoning-1", type: "reasoning", content: "Inspect workspace. " },
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1"] },
      { id: "reasoning-2", type: "reasoning", content: "Use the result." },
      { id: "content-1", type: "content", content: "Done." },
    ];

    const userMessage = state.createMessage("user", "Do it");
    const assistantMessage = state.createMessage("assistant", "Done.", {
      timeline,
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "list_directory",
          arguments: "{}",
          result: "listed: .",
          round: 1,
          status: "completed",
        },
      ],
    });

    await state.saveTurn({ userMessage, assistantMessage, model: "test-model" });

    assert.deepStrictEqual(saved?.messages[1].timeline, timeline);
    const apiMessages = state.getApiMessages();
    assert.strictEqual(apiMessages[1].reasoning_content, undefined);
    assert.strictEqual(apiMessages[1].content, "Done.");
    assert.strictEqual(apiMessages[1].content?.includes("YDSC_TOOL_ROUND"), false);
    assert.strictEqual(state.forget("another-conversation"), false);
    assert.strictEqual(state.forget(saved!.id), true);
    assert.deepStrictEqual(state.getApiMessages(), []);
  });

  test("compacts a completed provider transcript to user and final assistant text", async () => {
    const state = new ConversationState({ save: async () => undefined });
    const transcript = createProviderTranscript([
      {
        role: "assistant",
        content: null,
        reasoning_content: "Need the file.",
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: "{\"path\":\"src/a.ts\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call-1", name: "read_file", content: "literal result" },
      { role: "assistant", content: "Done.", reasoning_content: "Use result." },
    ], "complete");
    state.load({
      schemaVersion: 2,
      id: "conversation",
      title: "Canonical",
      createdAt: 1,
      updatedAt: 1,
      model: "deepseek-flash",
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      messages: [
        {
          id: "user",
          role: "user",
          content: "Read it",
          createdAt: 1,
          generationId: "generation-1",
        },
        {
          id: "assistant",
          role: "assistant",
          content: "Done.",
          createdAt: 2,
          generationId: "generation-1",
          generationStatus: "completed",
          providerTranscript: transcript,
        },
      ],
    });

    const units = state.getApiContextUnits();
    assert.strictEqual(units.length, 1);
    assert.strictEqual(units[0].generationId, "generation-1");
    assert.deepStrictEqual(units[0].messages, [
      { role: "user", content: "Read it" },
      { role: "assistant", content: "Done." },
    ]);
    const storedAssistant = state.getConversation()?.messages[1];
    assert.strictEqual(storedAssistant?.providerTranscript, undefined);
    assert.strictEqual(storedAssistant?.contextContent, "Done.");
    assert.doesNotMatch(units[0].visibleText, /literal result/);
  });

  test("keeps an incomplete recovery transcript stored but excludes it from future API context", () => {
    const state = new ConversationState({ save: async () => undefined });
    const incomplete = createProviderTranscript([{
      role: "assistant",
      content: "Visible partial",
      reasoning_content: "private recovery reasoning",
    }], "incomplete");
    state.load({
      schemaVersion: 2,
      id: "recovery",
      title: "Recovery",
      createdAt: 1,
      updatedAt: 1,
      model: "model",
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      messages: [{
        id: "assistant",
        role: "assistant",
        content: "Visible partial",
        generationStatus: "interrupted",
        providerTranscript: incomplete,
      }],
    });

    assert.strictEqual(state.getConversation()?.messages[0]?.providerTranscript?.status, "incomplete");
    assert.deepStrictEqual(state.getApiMessages(), [{ role: "assistant", content: "Visible partial" }]);
  });

  test("keeps interrupted visible content but omits incomplete reasoning and tools from API context", async () => {
    const state = new ConversationState({ save: async () => undefined });
    state.load({
      schemaVersion: 2,
      id: "conversation",
      title: "Interrupted",
      createdAt: 1,
      updatedAt: 1,
      model: "model",
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      messages: [{
        id: "assistant",
        role: "assistant",
        content: "partial answer",
        generationStatus: "interrupted",
        timeline: [{ id: "reasoning", type: "reasoning", content: "private partial reasoning" }],
        toolCalls: [{
          toolCallId: "call",
          toolName: "read_file",
          arguments: "{}",
          status: "cancelled",
          result: "cancelled",
        }],
      }],
    });

    assert.deepStrictEqual(state.getApiMessages(), [{ role: "assistant", content: "partial answer" }]);
  });

  test("uses compact contextContent for an interrupted generation", () => {
    const state = new ConversationState({ save: async () => undefined });
    state.load({
      schemaVersion: 2,
      id: "interrupted-ledger",
      title: "Interrupted ledger",
      createdAt: 1,
      updatedAt: 1,
      model: "model",
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      messages: [{
        id: "assistant",
        role: "assistant",
        content: "visible partial",
        contextContent: "machine execution ledger",
        generationStatus: "interrupted",
      }],
    });

    assert.deepStrictEqual(state.getApiMessages(), [{ role: "assistant", content: "machine execution ledger" }]);
  });

  test("persists a cancelled turn and keeps it available as bounded context", async () => {
    const saves: Conversation[] = [];
    const state = new ConversationState({ save: async (conversation) => {saves.push(structuredClone(conversation));} });
    state.load({
      schemaVersion: 2,
      id: "conversation",
      title: "Prior turn",
      createdAt: 10,
      updatedAt: 20,
      model: "model",
      workspaceUri: "file:///workspace",
      workspaceBinding: testWorkspaceBinding(),
      contextSummary: {
        schemaVersion: 2,
        provider: "local",
        content: "Summary of prior turns",
        coveredGenerationIds: ["prior"],
        sourceDigest: "digest",
        updatedAt: 15,
      },
      messages: [
        { id: "prior-user", role: "user", content: "Before", createdAt: 11, generationId: "prior" },
        { id: "prior-assistant", role: "assistant", content: "Answer", createdAt: 12, generationId: "prior" },
        { id: "cancel-user", role: "user", content: "Keep me", createdAt: 21, generationId: "cancelled" },
      ],
    });
    await state.saveMessages({
      model: "model",
      messages: [state.createMessage("assistant", "Partial", {
        generationId: "cancelled",
        generationStatus: "cancelled",
        generationStopReason: "user_cancelled",
        contextContent: "Partial",
      })],
    });

    assert.deepStrictEqual(state.getConversation()?.messages.map((message) => message.id), [
      "prior-user", "prior-assistant", "cancel-user", state.getConversation()?.messages.at(-1)?.id,
    ]);
    assert.deepStrictEqual(state.getApiMessages().slice(-2), [
      { role: "user", content: "Keep me" },
      { role: "assistant", content: "Partial" },
    ]);
    assert.strictEqual(saves.at(-1)?.messages.at(-1)?.generationStatus, "cancelled");
  });
});

function testWorkspaceBinding() {
  return {
    schemaVersion: 1 as const,
    uri: "file:///workspace",
    name: "workspace",
    revision: "test",
    folders: [],
    capabilities: { files: true, search: true, git: true, terminal: true },
  };
}

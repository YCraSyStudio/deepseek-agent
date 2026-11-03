import assert from "node:assert/strict";
import { act, createElement, createRef, useState } from "react";
import { useChatMessagesController } from "@/ui/hooks/chat/UseChatMessagesController";
import type { ChatMessage } from "@/ui/views/chatView/ChatViewTypes";
import { DEFAULT_CONFIG, type ContextWindowStatus } from "@/contracts";
import { createUsageAggregate } from "@/shared/usage/Usage";
import { createDomHarness } from "../../../../support/DomHarness";

type Options = Parameters<typeof useChatMessagesController>[0];
suite("chat messages controller observable lifecycle", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let hook: ReturnType<typeof useChatMessagesController>;
  let focus: number; let processing: boolean[]; let events: Array<[string, unknown]>;
  function Probe({ options = {} }: { options?: Partial<Options> }) {
    hook = useChatMessagesController({ conversationId: "chat", focusInput: () => { focus++; }, onProcessingChange: (value) => { processing.push(value); },
      onModelChanged: (value) => { events.push(["model", value]); }, onApiKeyStatusChange: (value) => { events.push(["key", value]); },
      onConfigLoaded: (value) => { events.push(["config", value]); }, onConfigUpdateResult: (value) => { events.push(["configResult", value]); },
      onConversationUsageUpdated: (value) => { events.push(["usage", value]); }, onContextWindowUpdated: (value) => { events.push(["context", value]); },
      onContextCompactionResult: (value) => { events.push(["compaction", value]); }, ...options });
    return createElement("div", { ref: hook.listRef }, hook.messages.map((message) => createElement("p", { key: message.id }, message.content)));
  }
  setup(async () => { h = await createDomHarness(); focus = 0; processing = []; events = []; await h.render(createElement(Probe)); });
  teardown(async () => { await h.dispose(); });
  async function run(action: () => void) { await act(async () => { action(); }); }
  async function add(content: string, role = "assistant", generationId = "generation", wasStreamed = false) {
    await run(() => hook.dispatcher.onAddMessage!({ role, content, generationId, wasStreamed }));
  }
  async function delta(generationId = "generation", content = "answer") {
    await run(() => hook.dispatcher.onStreamTimelineDelta!({ eventId: "answer", eventType: "content", content, generationId }));
  }
  test("adds messages and updates an existing user turn without duplication", async () => {
    await add("question", "user"); const id = hook.messages[0].id; await add("revised", "user"); await add("answer");
    assert.equal(hook.messages.length, 2); assert.equal(hook.messages[0].content, "revised"); assert.equal(hook.messages[0].id, id); assert.equal(hook.messages[1].content, "answer");
  });
  test("restores completed streamed messages when no local stream exists", async () => {
    await add("restored", "assistant", "generation", true); assert.equal(hook.messages.length, 1); assert.equal(hook.messages[0].content, "restored"); assert.equal(hook.messages[0].generationId, "generation");
  });
  test("stream completion patches the existing assistant instead of appending duplicate content", async () => {
    await run(() => hook.dispatcher.onShowTyping!("generation")); await delta();
    const timeline = [{ id: "complete", type: "content" as const, content: "answer" }];
    await run(() => hook.dispatcher.onAddMessage!({ role: "assistant", content: "answer", generationId: "generation", wasStreamed: true, timeline, toolCalls: [] }));
    assert.equal(hook.messages.length, 1); assert.equal(hook.messages[0].content, "answer"); assert.deepEqual(hook.messages[0].timeline, timeline); assert.deepEqual(hook.messages[0].toolCalls, []);
    await run(() => hook.dispatcher.onStreamDone!({ generationId: "generation", status: "completed", finish_reason: "stop" }));
    assert.equal(hook.messages[0].generationStatus, "completed"); assert.equal(hook.isProcessing, false); assert.deepEqual(processing, [true, false]); assert.equal(focus, 1);
  });
  test("keeps streamed timeline when a terminal message omits it", async () => {
    await add("question", "user"); await delta(); await add("ignored final duplicate", "assistant", "generation", true);
    assert.equal(hook.messages.length, 2); assert.equal(hook.messages[0].content, "question"); assert.deepEqual(hook.messages[1].timeline, [{ id: "answer", type: "content", content: "answer" }]);
  });
  test("rejects stale deltas, tool groups, terminal events and errors from another generation", async () => {
    await run(() => hook.dispatcher.onShowTyping!("generation")); await delta("stale");
    await run(() => { hook.dispatcher.onStreamTimelineToolGroup!({ id: "tools", type: "tool-group", round: 1, toolCallIds: [] }, "stale"); hook.dispatcher.onStreamDone!({ generationId: "stale", status: "completed" }); hook.dispatcher.onStreamError!("stale error", "stale"); });
    assert.deepEqual(hook.messages, []); assert.equal(hook.isProcessing, true); assert.equal(focus, 0);
  });
  test("accepts matching tool groups and unscoped events", async () => {
    await run(() => hook.dispatcher.onShowTyping!("generation"));
    const group = { id: "tools", type: "tool-group" as const, round: 1, toolCallIds: ["call"] };
    await run(() => hook.dispatcher.onStreamTimelineToolGroup!(group, "generation")); await run(() => hook.dispatcher.onStreamTimelineDelta!({ eventId: "answer", eventType: "content", content: "answer" }));
    await run(() => hook.dispatcher.onStreamDone!({ status: "completed" }));
    assert.ok(hook.messages[0].timeline?.some((event) => event.type === "tool-group")); assert.equal(hook.isProcessing, false);
  });
  for (const status of ["cancelled", "interrupted"] as const) {
    test(`records an empty ${status} assistant turn when no answer arrived`, async () => {
      await add("question", "user"); await run(() => hook.dispatcher.onShowTyping!("generation"));
      await run(() => hook.dispatcher.onStreamDone!({ generationId: "generation", status, generationStopReason: "user_cancelled" }));
      assert.equal(hook.messages.length, 2); assert.equal(hook.messages[1].role, "assistant"); assert.equal(hook.messages[1].content, ""); assert.equal(hook.messages[1].generationStatus, status); assert.equal(hook.messages[1].generationStopReason, "user_cancelled");
    });
  }
  test("completed generations without an answer do not create placeholder messages", async () => {
    await add("question", "user"); await run(() => hook.dispatcher.onStreamDone!({ generationId: "generation", status: "completed" })); assert.equal(hook.messages.length, 1);
  });
  test("marks only the final matching assistant turn as terminal", async () => {
    await add("first"); await add("other", "assistant", "other"); await add("last"); await add("next question", "user", "next");
    await run(() => hook.dispatcher.onStreamDone!({ generationId: "generation", status: "interrupted" }));
    assert.equal(hook.messages[0].generationStatus, undefined); assert.equal(hook.messages[1].generationStatus, undefined); assert.equal(hook.messages[2].generationStatus, "interrupted");
  });
  for (const [reason, expected] of [["length", /output limit/], ["content_filter", /filtered/], ["insufficient_system_resource", /resources were insufficient/], ["unexpected", /finish reason "unexpected"/]] as const) {
    test(`explains incomplete provider finish reason ${reason}`, async () => {
      await run(() => hook.dispatcher.onStreamDone!({ status: "completed", finish_reason: reason })); assert.equal(hook.messages[0].role, "error"); assert.match(hook.messages[0].content, expected);
    });
  }
  test("normal stop and tool-call finishes do not display incomplete-answer warnings", async () => {
    for (const finish_reason of [undefined, "stop", "tool_calls", ""]) { await run(() => hook.dispatcher.onStreamDone!({ status: "completed", finish_reason })); }
    assert.deepEqual(hook.messages, []);
  });
  test("errors mark matching assistant turns and deduplicate identical generation errors", async () => {
    await add("answer"); await add("other", "assistant", "other"); await run(() => hook.dispatcher.onShowTyping!("generation"));
    await run(() => hook.dispatcher.onStreamError!("network failed", "generation")); await run(() => hook.dispatcher.onStreamError!("network failed", "generation"));
    assert.equal(hook.messages.length, 3); assert.equal(hook.messages[0].generationStatus, "error"); assert.equal(hook.messages[1].generationStatus, undefined); assert.equal(hook.messages[2].content, "network failed"); assert.equal(hook.isProcessing, false); assert.equal(focus, 2);
    await run(() => hook.dispatcher.onStreamError!("unscoped failure")); assert.equal(hook.messages.length, 4);
  });
  test("usage patches the last matching assistant and leaves unknown generations unchanged", async () => {
    const usage = createUsageAggregate(true); await add("one"); await add("other", "assistant", "other"); await add("last");
    await run(() => hook.dispatcher.onAssistantUsageUpdated!({ generationId: "absent", usage })); assert.ok(hook.messages.every((message) => !message.usage));
    await run(() => hook.dispatcher.onAssistantUsageUpdated!({ generationId: "generation", usage })); assert.deepEqual(hook.messages[2].usage, usage); assert.equal(hook.messages[0].usage, undefined);
    await add("latest", "assistant", "latest"); await run(() => hook.dispatcher.onAssistantUsageUpdated!({ usage })); assert.deepEqual(hook.messages[3].usage, usage);
  });
  test("adds resource-limit errors and compaction markers then clears all chat state", async () => {
    await run(() => { hook.dispatcher.onContextCompacted!({ generationId: "generation" }); hook.dispatcher.onResourceLimitReached!({ resource: "memory", error: "limit reached" }); hook.dispatcher.onShowTyping!("generation"); });
    assert.deepEqual(hook.messages.map((message) => [message.role, message.content]), [["context", ""], ["error", "limit reached"]]);
    await run(() => hook.dispatcher.onClearChat!()); assert.deepEqual(hook.messages, []); assert.equal(hook.isProcessing, false);
  });
  test("forwards configuration, credentials, model and compaction results", async () => {
    const update = { type: "configUpdateResult" as const, requestId: "save", operation: "save" as const, status: "success" as const, revision: 2, config: DEFAULT_CONFIG };
    await run(() => { hook.dispatcher.onConfigLoaded!(DEFAULT_CONFIG, 1); hook.dispatcher.onConfigLoaded!({}, 2); hook.dispatcher.onConfigUpdateResult!(update); hook.dispatcher.onModelChanged!("model"); hook.dispatcher.onApiKeyStatus!("missing"); hook.dispatcher.onContextCompactionResult!({ requestId: "compact", status: "empty" }); });
    assert.equal((events[0][1] as { revision: number }).revision, 1); assert.equal((events[1][1] as { model?: string }).model, undefined);
    assert.deepEqual(events.slice(2), [["configResult", update], ["model", "model"], ["key", "missing"], ["compaction", { requestId: "compact", status: "empty" }]]);
  });
  test("correlates usage and context by conversation but permits unbound controllers", async () => {
    const usage = { byModel: [] }; const contextWindow: ContextWindowStatus = { model: "model", usedTokens: 1, windowTokens: 100, softLimitTokens: 80, hardLimitTokens: 90, compactions: 0, source: "measured" };
    await run(() => { hook.dispatcher.onConversationUsageUpdated!({ conversationId: "other", usage }); hook.dispatcher.onContextWindowUpdated!({ conversationId: "other", contextWindow }); }); assert.deepEqual(events, []);
    await run(() => { hook.dispatcher.onConversationUsageUpdated!({ conversationId: "chat", usage }); hook.dispatcher.onContextWindowUpdated!({ conversationId: "chat", contextWindow }); }); assert.deepEqual(events, [["usage", usage], ["context", contextWindow]]);
    await h.render(createElement(Probe, { options: { conversationId: undefined } })); await run(() => hook.dispatcher.onConversationUsageUpdated!({ conversationId: "other", usage })); assert.equal(events.length, 3);
  });
  test("generation snapshots select the current conversation and empty snapshots release stale filtering", async () => {
    const snapshot = (conversationId: string, generationId: string) => ({ conversationId, generationId, status: "streaming" as const, userMessage: { id: "user", role: "user" as const, content: "question" }, content: "", timeline: [], toolCalls: [], queue: [] });
    await run(() => hook.dispatcher.onGenerationSnapshot!({ type: "generationSnapshot", generations: [snapshot("other", "other"), snapshot("chat", "generation")], recoveredDrafts: [] }));
    await delta("other", "ignored"); assert.equal(hook.messages.length, 0);
    await delta("generation", "accepted"); await run(() => hook.dispatcher.onGenerationSnapshot!({ type: "generationSnapshot", generations: [], recoveredDrafts: [] }));
    assert.equal(hook.messages[0].content, "accepted");
    await delta("new", "new answer"); await run(() => hook.dispatcher.onStreamDone!({ status: "completed", generationId: "new" }));
    assert.equal(hook.messages.at(-1)?.content, "new answer");
  });
  test("does not recreate a streamed assistant removed by external history replacement", async () => {
    let replace!: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    function Controlled() { const [messages, setMessages] = useState<ChatMessage[]>([]); replace = setMessages; return createElement(Probe, { options: { externalMessages: messages, externalSetMessages: setMessages } }); }
    await h.render(createElement(Controlled)); await delta(); await run(() => hook.dispatcher.onAddMessage!({ role: "assistant", content: "answer", generationId: "generation", wasStreamed: true }));
    assert.equal(hook.messages.length, 1); await run(() => replace([])); await add("late duplicate", "assistant", "generation", true); assert.deepEqual(hook.messages, []);
  });

  test("optional observers do not prevent generation progress", async () => {
    await h.render(createElement(Probe, { options: { onProcessingChange: undefined, onConfigLoaded: undefined, onConfigUpdateResult: undefined, onModelChanged: undefined, onApiKeyStatusChange: undefined, onConversationUsageUpdated: undefined, onContextWindowUpdated: undefined, onContextCompactionResult: undefined } }));
    await run(() => { hook.dispatcher.onShowTyping!(); hook.dispatcher.onModelChanged!("model"); hook.dispatcher.onApiKeyStatus!("configured"); hook.dispatcher.onConfigLoaded!({}, 1); hook.dispatcher.onContextCompactionResult!({ requestId: "compact", status: "empty" }); hook.dispatcher.onConversationUsageUpdated!({ conversationId: "chat", usage: { byModel: [] } }); });
    await add("answer"); await run(() => hook.dispatcher.onStreamDone!({ status: "completed" }));
    assert.equal(hook.messages[0].content, "answer"); assert.deepEqual(events, []); assert.deepEqual(processing, []); assert.equal(focus, 1);
  });

  test("supports externally controlled messages, processing and list refs", async () => {
    const listRef = createRef<HTMLDivElement>();
    function Controlled() { const [messages, setMessages] = useState<ChatMessage[]>([]); return createElement(Probe, { options: { externalMessages: messages, externalSetMessages: setMessages, externalIsProcessing: true, externalListRef: listRef } }); }
    await h.render(createElement(Controlled)); await add("controlled"); assert.equal(hook.messages[0].content, "controlled"); assert.equal(hook.isProcessing, true); assert.equal(hook.listRef, listRef); assert.ok(listRef.current);
  });
});

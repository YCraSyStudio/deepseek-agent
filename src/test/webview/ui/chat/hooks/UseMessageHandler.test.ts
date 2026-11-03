import assert from "node:assert/strict";
import { createElement } from "react";
import { useMessageHandler, type MessageDispatcher } from "@/ui/views/chatView/hooks/UseMessageHandler";
import type { GenerationEventScopeSource } from "@/ui/views/chatView/hooks/GenerationEventScope";
import type { VsCodeApi } from "@/ui/VsCodeApi";
import { getUiLocale, setInterfaceLanguage } from "@/ui/i18n";
import { WEBVIEW_PROTOCOL_VERSION, type HandlerToWebviewMessage } from "@/contracts";
import { createUsageAggregate } from "@/shared/usage/Usage";
import { createDomHarness } from "../../../../support/DomHarness";

const generation = { conversationId: "chat", generationId: "generation" };
const usage = createUsageAggregate(true);
const contextWindow = { model: "model", usedTokens: 10, windowTokens: 100, softLimitTokens: 80, hardLimitTokens: 90, compactions: 0, source: "measured" as const };
const configResult = { type: "configUpdateResult" as const, requestId: "save", operation: "save" as const, status: "success" as const, revision: 2, config: {} };
const message = { role: "assistant" as const, content: "answer", generationId: "generation" };
const group = { id: "tools", type: "tool-group" as const, round: 1, toolCallIds: ["call"] };
const cases: Array<{ event: HandlerToWebviewMessage; callback: keyof MessageDispatcher; args: unknown[] }> = [
  { event: { type: "addMessage", ...generation, message }, callback: "onAddMessage", args: [message] },
  { event: { type: "showTyping", ...generation }, callback: "onShowTyping", args: ["generation"] },
  { event: { type: "streamTimelineDelta", ...generation, eventId: "delta", eventType: "reasoning", content: "thinking" }, callback: "onStreamTimelineDelta", args: [{ generationId: "generation", eventId: "delta", eventType: "reasoning", content: "thinking" }] },
  { event: { type: "streamTimelineToolGroup", ...generation, event: group }, callback: "onStreamTimelineToolGroup", args: [group, "generation"] },
  { event: { type: "streamDone", ...generation, status: "cancelled", finish_reason: "stop", generationStopReason: "user_cancelled" }, callback: "onStreamDone", args: [{ generationId: "generation", status: "cancelled", finish_reason: "stop", generationStopReason: "user_cancelled" }] },
  { event: { type: "streamError", ...generation, error: "network failed" }, callback: "onStreamError", args: ["network failed", "generation"] },
  { event: { type: "clearChat" }, callback: "onClearChat", args: [] },
  { event: { type: "modelChanged", modelId: "model" }, callback: "onModelChanged", args: ["model"] },
  { event: { type: "apiKeyStatus", status: "configured" }, callback: "onApiKeyStatus", args: ["configured"] },
  { event: { type: "configLoaded", config: {}, revision: 1 }, callback: "onConfigLoaded", args: [{}, 1] },
  { event: configResult, callback: "onConfigUpdateResult", args: [configResult] },
  { event: { type: "toolCallStarted", ...generation, toolCalls: [], round: 2 }, callback: "onToolCallStarted", args: [{ generationId: "generation", toolCalls: [], round: 2 }] },
  { event: { type: "toolCallResult", ...generation, toolCallId: "call", toolName: "read_file", result: "failed", isError: true, rejected: false, status: "error" }, callback: "onToolCallResult", args: [{ generationId: "generation", toolCallId: "call", toolName: "read_file", result: "failed", isError: true, rejected: false, status: "error" }] },
  { event: { type: "toolCallActionAccepted", ...generation, toolCallId: "call", status: "rejected" }, callback: "onToolCallActionAccepted", args: [{ generationId: "generation", toolCallId: "call", status: "rejected" }] },
  { event: { type: "toolCallConfirmationRequired", ...generation, toolCalls: [], round: 2, autoExecute: false }, callback: "onToolCallConfirmationRequired", args: [{ generationId: "generation", toolCalls: [], round: 2, autoExecute: false, dangerConfirmation: undefined }] },
  { event: { type: "contextCompactionUpdated", ...generation, status: "compacting" }, callback: "onContextCompactionUpdated", args: [{ generationId: "generation", status: "compacting" }] },
  { event: { type: "contextCompacted", ...generation }, callback: "onContextCompacted", args: [{ generationId: "generation" }] },
  { event: { type: "generationRecoveryStarted", ...generation, reason: "excessive_reasoning", message: "recovering" }, callback: "onGenerationRecoveryStarted", args: [{ generationId: "generation", message: "recovering" }] },
  { event: { type: "resourceLimitReached", ...generation, resource: "memory", error: "limit" }, callback: "onResourceLimitReached", args: [{ generationId: "generation", resource: "memory", error: "limit" }] },
  { event: { type: "generationSnapshot", generations: [], recoveredDrafts: [] }, callback: "onGenerationSnapshot", args: [{ type: "generationSnapshot", generations: [], recoveredDrafts: [] }] },
  { event: { type: "assistantUsageUpdated", ...generation, usage }, callback: "onAssistantUsageUpdated", args: [{ generationId: "generation", usage }] },
  { event: { type: "conversationUsageUpdated", conversationId: "chat", usage: { byModel: [] } }, callback: "onConversationUsageUpdated", args: [{ conversationId: "chat", usage: { byModel: [] } }] },
  { event: { type: "contextWindowUpdated", conversationId: "chat", contextWindow }, callback: "onContextWindowUpdated", args: [{ conversationId: "chat", contextWindow }] },
  { event: { type: "contextCompactionResult", requestId: "compact", status: "compacted", freedTokens: 100 }, callback: "onContextCompactionResult", args: [{ requestId: "compact", status: "compacted", freedTokens: 100, error: undefined }] },
];
suite("webview host-message routing contract", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>; let received: Array<[string, unknown[]]>; let host: VsCodeApi;
  setup(async () => { h = await createDomHarness(); received = []; setInterfaceLanguage("en"); host = { postMessage: (value) => { h.posts.push(value as Record<string, unknown>); }, getState: () => undefined, setState: (value) => value }; });
  teardown(async () => { setInterfaceLanguage("en"); await h.dispose(); });
  function Probe({ dispatcher, scope, connected = true }: { dispatcher: MessageDispatcher; scope?: GenerationEventScopeSource; connected?: boolean }) { useMessageHandler(connected ? host : null, dispatcher, scope); return createElement("div"); }
  function observers(): MessageDispatcher { return Object.fromEntries(cases.map(({ callback }) => [callback, (...args: unknown[]) => { received.push([callback, args]); }])); }
  for (const scenario of cases) {
    test(`routes ${scenario.event.type} to its single public callback with intact payload`, async () => {
      await h.render(createElement(Probe, { dispatcher: observers() })); await h.message(scenario.event); assert.deepEqual(received, [[scenario.callback, scenario.args]]);
    });
  }
  test("initializes the versioned protocol, config and generation snapshot once per connection", async () => {
    await h.render(createElement(Probe, { dispatcher: observers() })); assert.deepEqual(h.posts, [{ type: "initializeProtocol", protocolVersion: WEBVIEW_PROTOCOL_VERSION }, { type: "getConfig" }, { type: "getGenerationSnapshot" }]);
    await h.render(createElement(Probe, { dispatcher: observers() })); assert.equal(h.posts.length, 3);
  });
  test("uses the latest callbacks and scope without reconnecting", async () => {
    await h.render(createElement(Probe, { dispatcher: observers(), scope: { conversationId: "chat", activeGenerationId: "generation" } }));
    await h.message({ type: "showTyping", conversationId: "other", generationId: "generation" }); assert.deepEqual(received, []);
    await h.render(createElement(Probe, { dispatcher: { onShowTyping: (id) => { received.push(["updated", [id]]); } }, scope: () => ({ conversationId: "other", activeGenerationId: "new" }) }));
    await h.message({ type: "showTyping", conversationId: "other", generationId: "new" }); assert.deepEqual(received, [["updated", ["new"]]]); assert.equal(h.posts.length, 3);
  });
  test("detaches listeners on disconnect and unmount", async () => {
    await h.render(createElement(Probe, { dispatcher: observers(), connected: false })); await h.message({ type: "clearChat" }); assert.deepEqual(received, []); assert.equal(h.posts.length, 0);
    await h.render(createElement(Probe, { dispatcher: observers() })); await h.render(createElement("div")); await h.message({ type: "clearChat" }); assert.deepEqual(received, []);
  });
  test("tolerates missing observers and leaves unrelated host messages untouched", async () => {
    await h.render(createElement(Probe, { dispatcher: {} })); for (const { event } of cases) { await h.message(event); }
    await h.message({ type: "contextFilesSelected", files: [] }); assert.deepEqual(received, []); assert.equal(h.posts.length, 3);
  });
  test("applies interface language updates for both load and save responses", async () => {
    await h.render(createElement(Probe, { dispatcher: observers() }));
    await h.message({ type: "configLoaded", config: { interfaceLanguage: "es" }, revision: 1 }); assert.match(getUiLocale(), /^es/);
    await h.message({ ...configResult, config: { interfaceLanguage: "zh" } }); assert.match(getUiLocale(), /^zh/);
    assert.equal(received.length, 2);
  });
});

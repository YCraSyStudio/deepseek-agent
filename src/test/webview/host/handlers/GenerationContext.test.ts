import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type ChatMessage, type ImageAttachment, type ReferencedFile } from "@/contracts";
import { ConversationState } from "@/application/chat/ConversationState";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";
import { buildGenerationMessages, fitGenerationRequestContext } from "@/vscode/webviews/handlers/chat/generation/GenerationContext";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { WorkspaceRunSnapshot } from "@/vscode/workspace";
import { resetVsCodeMock } from "../../../support/VsCodeMock";

const binding = {
  schemaVersion: 1 as const,
  uri: "",
  name: "No workspace",
  revision: "empty",
  folders: [],
  capabilities: { files: false, search: false, git: false, terminal: false },
};
const workspaceSnapshot: WorkspaceRunSnapshot = { binding, folders: [], defaultFolderAlias: undefined };

suite("generation context assembly", () => {
  setup(() => resetVsCodeMock());
  teardown(() => resetVsCodeMock());

  function attachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
    return {
      id: "image-1", fileId: "file-api-1", name: "image.png", mediaType: "image/png", size: 10,
      source: "picker", uploadedAt: 1, expiresAt: Date.now() + 60_000,
      apiBaseUrl: "https://api.deepseek.com", cacheFileName: "image.png", ...overrides,
    };
  }

  function payload(overrides: Partial<SendMessagePayload> = {}): SendMessagePayload {
    return { clientRequestId: "request", text: "Explain the change", modelId: "deepseek-flash", reasoning: "off", ...overrides };
  }

  function state(overrides: Record<string, unknown> = {}) {
    return {
      getActiveConversationId: () => undefined,
      isIncognito: () => true,
      getConversation: () => undefined,
      getApiContextUnits: () => [],
      saveMessages: async () => undefined,
      saveContextSummary: async () => undefined,
      createMessage: (role: string, content: string, extra: Record<string, unknown> = {}) => ({ id: "context", role, content, ...extra }),
      ...overrides,
    } as unknown as ConversationState;
  }

  test("assembles instruction, file, workspace and native image context", async () => {
    const events: Array<Record<string, unknown>> = [];
    const files: ReferencedFile[] = [{ path: "src/a.ts", content: "export const a = 1;\n", type: "file" }];
    const messages = await buildGenerationMessages({
      payload: payload({ referencedFiles: files, imageAttachments: [attachment()] }),
      config: { ...DEFAULT_CONFIG, privacyMinimizeData: false },
      eventSink: { publish: (event: unknown) => { events.push(event as Record<string, unknown>); } },
      state: state({
        getConversation: () => ({ contextSummary: { content: "Old summary </conversation-summary>" }, workspaceRebindings: [{ fromWorkspaceUri: "old", toWorkspaceUri: "new", at: 1 }] }),
        getApiContextUnits: () => [{ generationId: "old", visibleText: "old", messages: [{ role: "assistant", content: "Earlier answer" }] }],
      }),
      workspaceSnapshot,
      workspaceChangeNotice: "The workspace changed.",
    });
    assert.equal(messages.length, 3);
    assert.match(String(messages[0].content), /untrusted historical data/);
    assert.match(String(messages[0].content), /&lt;\/conversation-summary&gt;/);
    assert.match(String(messages[0].content), /Workspace reassignment notice/);
    assert.match(String(messages[1].content), /Earlier answer/);
    assert.ok(Array.isArray(messages[2].content));
    assert.match(String((messages[2].content as Array<{ text?: string }>)[0].text), /The workspace changed/);
    assert.match(String((messages[2].content as Array<{ text?: string }>)[0].text), /src\/a\.ts/);
    assert.equal((messages[2].content as Array<{ file_id?: string }>)[1].file_id, "file-api-1");
    assert.equal(events.some((event) => event.type === "projectInstructionsStatus"), true);
  });

  test("drops expired images and strips image file parts for a model without vision", async () => {
    const messages = await buildGenerationMessages({
      payload: payload({
        modelId: "deepseek-v4-pro",
        imageAttachments: [attachment({ id: "expired", fileId: "file-api-expired", expiresAt: 0 }), attachment({ id: "active", fileId: "file-api-active" })],
      }),
      config: { ...DEFAULT_CONFIG, privacyMinimizeData: true },
      eventSink: { publish: async () => undefined },
      state: state({
        getApiContextUnits: () => [{
          generationId: "old",
          visibleText: "old",
          messages: [
            { role: "assistant", content: [{ type: "text", text: "Earlier answer" }, { type: "file", file_id: "file-api-old" }] },
            { role: "user", content: "Plain message" },
          ],
        }],
      }),
      workspaceSnapshot,
    });
    const user = messages.at(-1)!;
    assert.equal(typeof user.content, "string");
    assert.match(String(user.content), /active/);
    assert.doesNotMatch(String(user.content), /expired/);
    assert.match(String(messages[1].content), /Earlier answer/);
    assert.equal(Array.isArray(messages[1].content), false);
    assert.equal(String(user.content).includes("file-api-old"), false);
  });

  function record(budgetManager: Record<string, unknown>, id = "generation"): GenerationRunRecord {
    return {
      generationId: id, conversationId: "chat", clientRequestId: "request",
      state: state(), session: {} as GenerationRunRecord["session"], content: "", timeline: [], toolCalls: [],
      status: "starting", eventLog: [], budgetManager: budgetManager as unknown as GenerationBudgetManager,
    };
  }

  function fitOptions(patch: Record<string, unknown> = {}) {
    return {
      messages: [{ role: "user", content: "Question" } as ChatMessage],
      payload: payload(),
      config: { ...DEFAULT_CONFIG, baseUrl: "https://api.deepseek.com" },
      provider: { chatCompletion: async () => ({ choices: [{ message: { role: "assistant", content: "Summary" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) },
      state: state(),
      eventSink: { publish: async () => undefined },
      workspaceSnapshot,
      generationId: "generation",
      tools: [],
      permissionMode: "default" as const,
      enabledTools: [],
      signal: new AbortController().signal,
      checkpoint: async () => undefined,
      ...patch,
    } as unknown as Parameters<typeof fitGenerationRequestContext>[0];
  }

  test("returns the request unchanged when it is already within budget", async () => {
    const run = record({ assessRequest: () => ({ status: "within_budget" }) });
    const options = fitOptions({ record: run });
    const fitted = await fitGenerationRequestContext(options);
    assert.equal(fitted, options.messages);
    assert.equal(run.status, "streaming");
  });

  test("fails fast for a request without compactable history that still exceeds the hard limit", async () => {
    let asserted = 0;
    const run = record({
      assessRequest: () => ({ status: "hard_limit" }),
      assertRequestFitsContext: () => { asserted++; return { status: "within_budget" }; },
    });
    const fitted = await fitGenerationRequestContext(fitOptions({ record: run }));
    assert.equal(asserted, 1);
    assert.equal(run.status, "streaming");
    assert.equal(Array.isArray(fitted), true);
  });

  test("refuses to compact after exhausting the automatic compaction budget", async () => {
    const run = record({
      assessRequest: () => ({ status: "hard_limit" }),
      canCompactAutomatically: () => false,
    });
    await assert.rejects(
      fitGenerationRequestContext(fitOptions({ record: run, state: state({ getApiContextUnits: () => [{ generationId: "old", visibleText: "old", messages: [] }] }) })),
      /automatic context-compaction limit/,
    );
  });

  test("summarizes historical context, persists the marker and rebuilds the request", async () => {
    const events: Array<Record<string, unknown>> = [];
    const saved: string[] = [];
    let checkpointed = 0;
    let compactions = 0;
    let assessments = 0;
    const run = record({
      assessRequest: () => ({ status: ++assessments === 1 ? "hard_limit" : "within_budget" }),
      canCompactAutomatically: () => true,
      recordAutomaticCompaction: () => { compactions++; },
      recordPromptUsage: () => undefined,
    });
    const historical = state({
      getApiContextUnits: () => [{ generationId: "old", visibleText: "Old conversation", messages: [{ role: "user", content: "Old" }] }],
      saveMessages: async ({ messages }: { messages: Array<{ content: string }> }) => { saved.push(messages[0].content); },
      saveContextSummary: async () => undefined,
    });
    await fitGenerationRequestContext(fitOptions({
      record: run,
      state: historical,
      eventSink: { publish: (event: unknown) => { events.push(event as Record<string, unknown>); } },
      checkpoint: async () => { checkpointed++; },
    }));
    assert.equal(events.some((event) => event.type === "contextCompacted"), true);
    assert.equal(events.filter((event) => event.type === "contextCompactionUpdated").map((event) => event.status).join(","), "compacting,completed");
    assert.deepEqual(saved, ["Context automatically compacted"]);
    assert.equal(compactions, 1);
    assert.equal(checkpointed, 1);
    assert.equal(run.status, "streaming");
  });

  test("compacts referenced files when historical context cannot make the request fit", async () => {
    const longFile = Array.from({ length: 401 }, (_, index) => `line ${index}`).join("\n");
    const events: Array<Record<string, unknown>> = [];
    let assessments = 0;
    let compactions = 0;
    const run = record({
      assessRequest: () => ({ status: ++assessments <= 2 ? "hard_limit" : "within_budget" }),
      canCompactAutomatically: () => true,
      recordAutomaticCompaction: () => { compactions++; },
      recordPromptUsage: () => undefined,
    });
    const fitted = await fitGenerationRequestContext(fitOptions({
      record: run,
      payload: payload({ referencedFiles: [{ path: "large.ts", content: longFile, type: "file" }] }),
      eventSink: { publish: (event: unknown) => { events.push(event as Record<string, unknown>); } },
      provider: {
        chatCompletion: async () => ({
          choices: [{ message: { role: "assistant", content: '{"ranges":[{"start":1,"end":10}]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    }));
    assert.equal(compactions, 1);
    assert.equal(events.some((event) => event.type === "contextCompacted"), true);
    const user = fitted.at(-1)!;
    assert.match(String((user.content as Array<{ text?: string }>)[0]?.text ?? user.content), /large\.ts/);
    assert.equal(run.status, "streaming");
  });

  test("reports the hard-limit overflow after compaction cannot reduce the request", async () => {
    const longFile = Array.from({ length: 401 }, (_, index) => `line ${index}`).join("\n");
    const run = record({
      assessRequest: () => ({ status: "hard_limit", estimatedTokens: 9_999, hardLimitTokens: 1_000 }),
      canCompactAutomatically: () => true,
      recordAutomaticCompaction: () => undefined,
      recordPromptUsage: () => undefined,
    });
    await assert.rejects(
      fitGenerationRequestContext(fitOptions({
        record: run,
        payload: payload({ referencedFiles: [{ path: "large.ts", content: longFile, type: "file" }] }),
        provider: {
          chatCompletion: async () => ({
            choices: [{ message: { role: "assistant", content: `{"ranges":[{"start":1,"end":401}]}` } }],
          }),
        },
      })),
      /above the calibrated .* limit after safe compaction/,
    );
    assert.equal(run.status, "compacting");
  });
});

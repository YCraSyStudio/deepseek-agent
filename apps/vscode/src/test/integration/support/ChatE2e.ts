import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type PermissionMode,
  type PermissionSnapshot,
  type StreamChunk,
  type WebviewToHandlerMessage,
} from "@/contracts";
import type {
  ModelProvider,
  ModelProviderFactory,
  SecretStore,
  SettingsRepository,
} from "@/application/ports";
import { ToolRegistry } from "@/application/tools";
import type { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import { BUILT_IN_TOOLS } from "@/infrastructure/tools/builtins";
import { HistoryManager } from "@/vscode/storage";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";

export interface PostedMessage {
  type: string;
  [key: string]: unknown;
}

interface ToolCallScript {
  name: string;
  arguments: Record<string, unknown>;
  id?: string;
}

type StreamRound =
  | { text: string; delayedMs?: number }
  | { text?: string; toolCalls: ToolCallScript[]; delayedMs?: number };

type AssistantRound = StreamRound | { failure: { status: number; message: string; code?: string } };

export interface ChatE2eOptions {
  settings?: Partial<AppConfig>;
  permissionMode?: PermissionMode;
}

const TERMINAL_TYPES = new Set(["streamDone", "streamError"]);
const REVIEW_DECISION = '{"decision":"complete","reason":"The candidate answers the request."}';

export class ChatE2e {
  readonly posts: PostedMessage[] = [];
  readonly transport = new DeepSeekTransport();
  readonly settings: E2eSettings;
  readonly history: HistoryManager;
  readonly handler: ChatHandler;
  readonly view: vscode.WebviewView;
  private readonly conversations = new Set<string>();
  private closed = false;

  private constructor(components: {
    settings: E2eSettings;
    history: HistoryManager;
    handler: ChatHandler;
    view: vscode.WebviewView;
    posts: PostedMessage[];
  }) {
    this.settings = components.settings;
    this.history = components.history;
    this.handler = components.handler;
    this.view = components.view;
    this.posts = components.posts;
  }

  static async create(options: ChatE2eOptions = {}): Promise<ChatE2e> {
    const settings = new E2eSettings({
      historyEnabled: true,
      webSearchEnabled: false,
      betaFeaturesEnabled: false,
      permissionMode: options.permissionMode ?? "default",
      snapshotStorageLimitMb: 64,
      ...options.settings,
    });
    const history = new HistoryManager(settings);
    await history.initialize();
    const registry = new ToolRegistry();
    for (const tool of BUILT_IN_TOOLS) {registry.register(tool);}
    const posts: PostedMessage[] = [];
    const view = createWebviewView(posts);
    const handler = new ChatHandler(
      history,
      registry,
      { dispose: async () => undefined } as unknown as HeadlessWebRuntime,
      settings,
      createSecretStore(),
      createProviderFactory(),
      async () => undefined,
    );
    handler.attachWebview(view);
    await handler.initialize();
    const harness = new ChatE2e({ settings, history, handler, view, posts });
    harness.transport.install();
    return harness;
  }

  send(text: string, overrides: Record<string, unknown> = {}): string {
    const clientRequestId = typeof overrides.clientRequestId === "string"
      ? overrides.clientRequestId
      : randomUUID();
    const message = {
      type: "sendMessage",
      text,
      modelId: "deepseek-flash",
      reasoning: "off",
      clientRequestId,
      workspaceRevision: captureCurrentWorkspaceBinding().revision,
      ...overrides,
    };
    this.handler.handle(message as unknown as WebviewToHandlerMessage, this.view);
    return clientRequestId;
  }

  async startTurn(text: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const before = this.generationIds().length;
    this.send(text, overrides);
    return await this.waitForGeneration(before);
  }

  async runTurn(text: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const generationId = await this.startTurn(text, overrides);
    await this.waitForTerminal(generationId);
    return generationId;
  }

  async acceptToolCall(toolCallId: string, generationId?: string, action: "execute" | "reject" = "execute"): Promise<void> {
    const id = generationId ?? this.lastGenerationId();
    if (!id) {throw new Error("No generation has started yet.");}
    this.handler.handle({
      type: "executeToolCall",
      generationId: id,
      toolCallId,
      action,
    } as unknown as WebviewToHandlerMessage, this.view);
  }

  async settleToolCall(toolCallId: string, generationId: string, action: "execute" | "reject" = "execute"): Promise<PostedMessage> {
    const deadline = Date.now() + 20_000;
    let answered = 0;
    while (Date.now() < deadline) {
      const confirmations = this.posts.filter(
        (post) => post.type === "toolCallConfirmationRequired" && toolCallIncludes(post, toolCallId),
      );
      while (answered < confirmations.length) {
        answered += 1;
        await this.acceptToolCall(toolCallId, generationId, action);
        if (action === "reject") {break;}
      }
      const result = this.posts.find(
        (post) => post.type === "toolCallResult" &&
          post.toolCallId === toolCallId &&
          post.status !== "awaiting_confirmation",
      );
      if (result) {return result;}
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      `Timed out settling ${toolCallId}. Recent posts: ${JSON.stringify(this.posts.slice(-4))}`,
    );
  }

  async cancel(generationId?: string): Promise<void> {
    const id = generationId ?? this.lastGenerationId();
    if (!id) {throw new Error("No generation has started yet.");}
    this.handler.handle({
      type: "cancelGeneration",
      requestId: randomUUID(),
      generationId: id,
      conversationId: this.conversationIdFor(id),
    } as unknown as WebviewToHandlerMessage, this.view);
  }

  waitFor(predicate: (posts: readonly PostedMessage[]) => boolean, description: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const poll = (): void => {
        if (predicate(this.posts)) {resolve(); return;}
        if (Date.now() > deadline) {
          const terminal = this.posts.filter((post) => TERMINAL_TYPES.has(post.type));
          reject(new Error(`Timed out waiting for ${description}. Terminal events: ${JSON.stringify(terminal.slice(-3))}`));
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });
  }

  waitForPost(type: string, timeoutMs?: number): Promise<PostedMessage> {
    return this.waitFor(
      (posts) => posts.some((post) => post.type === type),
      type,
      timeoutMs,
    ).then(() => {
      const found = this.posts.find((post) => post.type === type);
      if (!found) {throw new Error(`Missing ${type}`);}
      return found;
    });
  }

  waitForPostMatching(type: string, match: (post: PostedMessage) => boolean, description = type, timeoutMs?: number): Promise<PostedMessage> {
    return this.waitFor(
      (posts) => posts.some((post) => post.type === type && match(post)),
      description,
      timeoutMs,
    ).then(() => {
      const found = [...this.posts].reverse().find((post) => post.type === type && match(post));
      if (!found) {throw new Error(`Missing ${description}`);}
      return found;
    });
  }

  async waitForTerminal(generationId: string): Promise<PostedMessage> {
    await this.waitFor(
      (posts) => posts.some((post) => TERMINAL_TYPES.has(post.type) && post.generationId === generationId),
      `a terminal event for ${generationId}`,
    );
    const terminal = this.posts.find((post) => TERMINAL_TYPES.has(post.type) && post.generationId === generationId);
    if (!terminal) {throw new Error(`Missing terminal event for ${generationId}`);}
    return terminal;
  }

  generationIds(): string[] {
    return this.posts
      .filter((post) => post.type === "generationAccepted" && typeof post.generationId === "string")
      .map((post) => post.generationId as string);
  }

  lastGenerationId(): string | undefined {
    return this.generationIds().at(-1);
  }

  conversationIdFor(generationId: string): string | undefined {
    const accepted = this.posts.find(
      (post) => post.type === "generationAccepted" && post.generationId === generationId,
    );
    return typeof accepted?.conversationId === "string" ? accepted.conversationId : undefined;
  }

  messagesOfType(type: string): PostedMessage[] {
    return this.posts.filter((post) => post.type === type);
  }

  async dispose(): Promise<void> {
    if (this.closed) {return;}
    this.closed = true;
    try {
      for (const generationId of this.generationIds()) {
        const conversationId = this.conversationIdFor(generationId);
        if (conversationId) {this.conversations.add(conversationId);}
      }
      await this.handler.shutdown();
    } finally {
      this.transport.restore();
      for (const conversationId of this.conversations) {
        await this.history.delete(conversationId).catch(() => undefined);
      }
    }
  }

  private async waitForGeneration(previousCount: number): Promise<string> {
    await this.waitFor(
      (posts) => posts.filter((post) => post.type === "generationAccepted").length > previousCount,
      "a generation to start",
    );
    const generationId = this.generationIds()[previousCount];
    if (!generationId) {throw new Error("Generation was not accepted");}
    const conversationId = this.conversationIdFor(generationId);
    if (conversationId) {this.conversations.add(conversationId);}
    return generationId;
  }
}

export class E2eSettings implements SettingsRepository {
  private config: AppConfig;
  private revision = 1;

  constructor(overrides: Partial<AppConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
  }

  load(): AppConfig {
    return this.config;
  }

  async save(patch: Partial<AppConfig>): Promise<void> {
    this.config = { ...this.config, ...patch };
    this.revision += 1;
  }

  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    this.revision += 1;
  }

  getRevision(): number {
    return this.revision;
  }

  async waitForPendingWrites(): Promise<void> {}

  async capturePermissionSnapshot(workspaceTrusted: boolean): Promise<PermissionSnapshot> {
    const permissionMode = workspaceTrusted ? this.config.permissionMode : "default";
    return {
      revision: this.revision,
      permissionMode,
      workspaceTrusted,
      fingerprint: JSON.stringify({ revision: this.revision, permissionMode, workspaceTrusted }),
    };
  }

  getPersistenceError(): string | undefined {
    return undefined;
  }

  enterDegradedMode(): void {}
}

class DeepSeekTransport {
  readonly requests: Array<Record<string, unknown>> = [];
  private readonly script: AssistantRound[] = [];
  private originalFetch?: typeof fetch;
  private installed = false;
  private toolCallSequence = 0;

  install(): this {
    if (this.installed) {return this;}
    this.originalFetch = globalThis.fetch;
    this.installed = true;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      this.requests.push(body);
      if (body.stream !== true) {
        return jsonResponse(body.model, REVIEW_DECISION);
      }
      const round = this.script.shift();
      if (!round) {
        throw new Error("Unexpected provider round: the e2e script has no remaining scripted response.");
      }
      if ("failure" in round) {
        return new Response(JSON.stringify({
          error: {
            message: round.failure.message,
            ...(round.failure.code ? { code: round.failure.code } : {}),
          },
        }), { status: round.failure.status, headers: { "content-type": "application/json" } });
      }
      return sseResponse("toolCalls" in round
        ? {
            ...round,
            toolCalls: round.toolCalls.map((toolCall) => ({
              ...toolCall,
              id: toolCall.id ?? `call_${++this.toolCallSequence}`,
            })),
          }
        : round);
    }) as typeof fetch;
    return this;
  }

  restore(): void {
    if (this.originalFetch) {globalThis.fetch = this.originalFetch;}
    this.installed = false;
  }

  respond(...rounds: AssistantRound[]): this {
    this.script.push(...rounds);
    return this;
  }

  get remaining(): number {
    return this.script.length;
  }

  streamedRequests(): Array<Record<string, unknown>> {
    return this.requests.filter((request) => request.stream === true);
  }

  lastUserMessage(): string | undefined {
    const last = this.streamedRequests().at(-1);
    const messages = Array.isArray(last?.messages) ? last.messages as Array<{ role?: string; content?: unknown }> : [];
    const user = [...messages].reverse().find((message) => message.role === "user");
    return typeof user?.content === "string" ? user.content : undefined;
  }

  allContent(): string {
    return this.streamedRequests().map((request) => JSON.stringify(request)).join("\n");
  }
}

function createWebviewView(posts: PostedMessage[]): vscode.WebviewView {
  return {
    webview: {
      postMessage: async (message: unknown): Promise<boolean> => {
        if (message && typeof message === "object" && typeof (message as { type?: unknown }).type === "string") {
          posts.push(message as PostedMessage);
        }
        return true;
      },
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
      asWebviewUri: (uri: unknown) => uri,
      cspSource: "vscode-resource:",
      options: {},
      html: "",
    },
    onDidDispose: () => ({ dispose: () => undefined }),
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    visible: true,
    viewType: "deepseek-agent.chatView",
    title: "Chat",
    show: () => undefined,
  } as unknown as vscode.WebviewView;
}

function toolCallIncludes(post: PostedMessage, toolCallId: string): boolean {
  return Array.isArray(post.toolCalls) &&
    (post.toolCalls as Array<{ id?: unknown }>).some((toolCall) => toolCall.id === toolCallId);
}

function createSecretStore(): SecretStore {
  return {
    migrateLegacyApiKey: async () => undefined,
    getApiKey: async () => "e2e-api-key",
    setApiKey: async () => undefined,
    deleteApiKey: async () => undefined,
  };
}

function createProviderFactory(): ModelProviderFactory {
  const provider: ModelProvider = {
    id: "e2e-summary",
    name: "e2e summary",
    async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      return {
        id: "e2e-summary",
        object: "chat.completion",
        created: 1,
        model: request.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Earlier work summary." } }],
      };
    },
    async chatCompletionStream(_request: ChatCompletionRequest, onChunk: (chunk: StreamChunk) => void): Promise<void> {
      onChunk({ type: "content", content: "Earlier work summary." });
      onChunk({ type: "done", finish_reason: "stop" });
    },
    async testConnection(): Promise<{ success: boolean }> {
      return { success: true };
    },
    async listModels(): Promise<Array<{ id: string; name: string }>> {
      return [];
    },
  };
  return { create: () => provider };
}

function jsonResponse(model: unknown, content: string): Response {
  return new Response(JSON.stringify({
    id: "e2e-review",
    object: "chat.completion",
    created: 1,
    model: typeof model === "string" ? model : "deepseek-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function sseResponse(round: StreamRound): Response {
  const toolCalls = "toolCalls" in round ? round.toolCalls : [];
  const events: unknown[] = [];
  if (round.text) {
    events.push({ choices: [{ delta: { content: round.text }, finish_reason: null }] });
  }
  for (const [index, toolCall] of toolCalls.entries()) {
    events.push({
      choices: [{
        delta: {
          tool_calls: [{
            index,
            id: toolCall.id ?? `call_${index + 1}`,
            type: "function",
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
          }],
        },
        finish_reason: null,
      }],
    });
  }
  const finishReason = toolCalls.length ? "tool_calls" : "stop";
  events.push({ choices: [{ delta: {}, finish_reason: finishReason }] });
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  if (!round.delayedMs) {
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const encoder = new TextEncoder();
  const delay = round.delayedMs;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(body.slice(0, body.indexOf("data: [DONE]"))));
        await new Promise((resolve) => setTimeout(resolve, delay));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        // The generation aborted the stream while the scripted delay was running.
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

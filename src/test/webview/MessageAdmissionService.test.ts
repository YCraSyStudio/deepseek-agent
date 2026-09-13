import assert from "node:assert/strict";
import type * as vscode from "vscode";
import type { ReferencedFile, WorkspaceBinding } from "@/contracts";
import type { ConversationState } from "@/application/chat/ConversationState";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SettingsRepository } from "@/application/ports";
import type { HistoryManager } from "@/vscode/storage";
import type { ConversationWorkspaceReferences } from "@/vscode/webviews/handlers/chat/session/ConversationWorkspaceReferences";
import { MessageAdmissionService } from "@/vscode/webviews/handlers/chat/messaging/MessageAdmissionService";
import type { SlashCommandService } from "@/vscode/webviews/handlers/chat/messaging/SlashCommandService";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";

suite("message admission service", () => {
  test("validates file references before admitting a normalized request", async () => {
    const events: string[] = [];
    const admitted: Array<{ task: Record<string, unknown>; front?: boolean }> = [];
    const binding = emptyWorkspaceBinding();
    const normalizedFiles: ReferencedFile[] = [{
      name: "main.ts",
      path: "main.ts",
      type: "file",
      referenceId: "file-1",
    }];
    const service = createService({
      binding,
      events,
      admitted,
      normalizedFiles,
    });

    await service.accept(payload({ referencedFiles: [{ ...normalizedFiles[0]!, path: "./main.ts" }] }), true);

    assert.deepStrictEqual(events, ["settings:flush", "slash", "binding", "files", "enqueue"]);
    assert.strictEqual(admitted[0]?.front, true);
    assert.deepStrictEqual(
      (admitted[0]?.task.payload as SendMessagePayload).referencedFiles,
      normalizedFiles,
    );
  });

  test("rejects a stale workspace revision before validating files or enqueueing", async () => {
    const events: string[] = [];
    const admitted: Array<{ task: Record<string, unknown>; front?: boolean }> = [];
    const posts: Array<Record<string, unknown>> = [];
    const service = createService({
      binding: emptyWorkspaceBinding(),
      events,
      admitted,
      posts,
      normalizedFiles: [],
    });

    await service.accept(payload({ workspaceRevision: "stale" }));

    assert.deepStrictEqual(events, ["settings:flush", "slash", "binding", "context"]);
    assert.strictEqual(admitted.length, 0);
    assert.strictEqual(posts[0]?.type, "requestRejected");
    assert.match(String(posts[0]?.error), /workspace changed/i);
  });
});

interface CreateServiceOptions {
  binding: WorkspaceBinding;
  events: string[];
  admitted: Array<{ task: Record<string, unknown>; front?: boolean }>;
  normalizedFiles: ReferencedFile[];
  posts?: Array<Record<string, unknown>>;
}

function createService({
  binding,
  events,
  admitted,
  normalizedFiles,
  posts = [],
}: CreateServiceOptions): MessageAdmissionService {
  const conversationState = {
    isIncognito: () => true,
    getActiveConversationId: () => "conversation-1",
  } as unknown as ConversationState;
  const coordinator = {
    enqueue: (task: Record<string, unknown>, front?: boolean) => {
      events.push("enqueue");
      admitted.push({ task, front });
    },
  } as unknown as GenerationCoordinator<SendMessagePayload>;
  const settings = {
    waitForPendingWrites: async () => events.push("settings:flush"),
    load: () => ({ model: "deepseek-chat" }),
  } as unknown as SettingsRepository;
  const slashCommands = {
    handle: async () => {
      events.push("slash");
      return false;
    },
  } as unknown as SlashCommandService;
  const workspaceReferences = {
    getBinding: async () => {
      events.push("binding");
      return binding;
    },
    validateFiles: async () => {
      events.push("files");
      return normalizedFiles;
    },
    postContext: () => events.push("context"),
  } as unknown as ConversationWorkspaceReferences;

  return new MessageAdmissionService({
    conversationState,
    coordinator,
    getWebview: () => ({}) as vscode.WebviewView,
    hasHistoryTransition: () => false,
    historyManager: {} as HistoryManager,
    isShuttingDown: () => false,
    loadConversation: () => undefined,
    onConversationCreated: () => undefined,
    post: (message) => posts.push(message),
    resolveWorkspaceContext: (workspaceBinding) => ({
      binding: workspaceBinding,
      state: "empty",
    }),
    settings,
    slashCommands,
    workspaceReferences,
  });
}

function payload(overrides: Partial<SendMessagePayload> = {}): SendMessagePayload {
  return {
    text: "Explain this file",
    modelId: "deepseek-chat",
    reasoning: "off",
    conversationId: "conversation-1",
    clientRequestId: "request-1",
    ...overrides,
  };
}

function emptyWorkspaceBinding(): WorkspaceBinding {
  return {
    schemaVersion: 1,
    uri: "ycrasy-workspace:empty",
    name: "No workspace",
    revision: "empty-revision",
    folders: [],
    capabilities: { files: false, search: false, git: false, terminal: false },
  };
}

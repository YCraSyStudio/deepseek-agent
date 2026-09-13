import assert from "node:assert/strict";
import type * as vscode from "vscode";
import type { AppConfig } from "@/contracts";
import type { SettingsRepository } from "@/application/ports";
import type { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { HistoryTransitionController } from "@/vscode/webviews/handlers/HistoryTransitionController";

suite("history transition controller", () => {
  test("enters incognito only after persisting the disabled setting", async () => {
    const events: string[] = [];
    const messages: Array<Record<string, unknown>> = [];
    const settings = createSettings(events, true);
    const chatHandler = createChatHandler(events, { activeGenerations: 0, queuedMessages: 0 });
    const view = createWebview(messages);
    const controller = new HistoryTransitionController({
      chatHandler,
      settings,
      postUpdateResult: async (_view, _requestId, _operation, status) => {
        events.push(`result:${status}`);
      },
    });

    await controller.request({
      requestId: "enter-1",
      operation: "save",
      targetEnabled: false,
      config: { historyEnabled: false },
      webviewView: view,
    });

    assert.deepStrictEqual(events, [
      "begin:enter-incognito",
      "settings:save:false",
      "chat:enter",
      "result:success",
    ]);
    assert.strictEqual(messages[0]?.type, "configLoaded");
  });

  test("requires an explicit save decision before promoting incognito messages", async () => {
    const events: string[] = [];
    const messages: Array<Record<string, unknown>> = [];
    const settings = createSettings(events, false);
    const chatHandler = createChatHandler(
      events,
      { activeGenerations: 0, queuedMessages: 0 },
      true,
    );
    const view = createWebview(messages);
    const controller = new HistoryTransitionController({
      chatHandler,
      settings,
      postUpdateResult: async (_view, _requestId, _operation, status) => {
        events.push(`result:${status}`);
      },
    });

    await controller.request({
      requestId: "exit-1",
      operation: "save",
      targetEnabled: true,
      config: { historyEnabled: true },
      webviewView: view,
    });

    assert.strictEqual(messages[0]?.type, "historyTransitionRequired");
    assert.strictEqual(messages[0]?.phase, "exit-incognito");
    assert.ok(!events.includes("chat:promote"));

    await controller.resolve("exit-1", "save", view);

    assert.deepStrictEqual(events, [
      "begin:exit-incognito",
      "chat:phase:exit-incognito",
      "settings:save:true",
      "chat:promote",
      "result:success",
    ]);
  });
});

function createSettings(events: string[], historyEnabled: boolean): SettingsRepository {
  let config = { historyEnabled } as AppConfig;
  return {
    load: () => config,
    save: async (patch: Partial<AppConfig>) => {
      config = { ...config, ...patch };
      events.push(`settings:save:${String(patch.historyEnabled)}`);
      return config;
    },
    reset: async () => {
      config = { historyEnabled: true } as AppConfig;
      events.push("settings:reset");
      return config;
    },
    getRevision: () => 1,
  } as unknown as SettingsRepository;
}

function createChatHandler(
  events: string[],
  counts: { activeGenerations: number; queuedMessages: number },
  hasIncognitoMessages = false,
): ChatHandler {
  return {
    beginHistoryTransition: (_requestId: string, direction: string) => {
      events.push(`begin:${direction}`);
      return counts;
    },
    cancelHistoryTransition: () => events.push("chat:cancel"),
    setHistoryTransitionPhase: (phase: string) => events.push(`chat:phase:${phase}`),
    stopPendingWork: async () => events.push("chat:stop"),
    hasIncognitoMessages: () => hasIncognitoMessages,
    enterIncognito: async () => events.push("chat:enter"),
    promoteIncognito: async () => events.push("chat:promote"),
    discardIncognito: () => events.push("chat:discard"),
  } as unknown as ChatHandler;
}

function createWebview(messages: Array<Record<string, unknown>>): vscode.WebviewView {
  return {
    webview: {
      postMessage: async (message: Record<string, unknown>) => {
        messages.push(message);
        return true;
      },
    },
  } as unknown as vscode.WebviewView;
}

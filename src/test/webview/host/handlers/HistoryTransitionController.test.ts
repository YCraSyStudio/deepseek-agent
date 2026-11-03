import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG, type AppConfig } from "@/contracts";
import type { SettingsRepository } from "@/application/ports";
import type { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { HistoryTransitionController } from "@/vscode/webviews/handlers/HistoryTransitionController";

suite("incognito transition characterization", () => {
  test("enters incognito only after its setting is durably saved", async () => {
    const h = harness();
    await h.request(false);
    assert.deepEqual(h.events, ["begin:enter-incognito", "save", "configLoaded", "enter"]);
    assert.equal(h.config.historyEnabled, false);
    assert.equal(h.results[0]!.status, "success");
  });

  test("a competing transition reports an error without changing configuration", async () => {
    const h = harness(); h.busy = true;
    await h.request(false);
    assert.match(h.results[0]!.error!, /already pending/);
    assert.equal(h.config.historyEnabled, true);
  });

  for (const queued of [false, true]) {
    test(`asks before interrupting pending work, queued=${queued}`, async () => {
      const h = harness(); h.active = queued ? 0 : 1; h.queued = queued ? 1 : 0;
      await h.request(false);
      assert.equal(h.posts[0]!.phase, "stop-work");
      assert.equal(h.posts[0]!.direction, "enter-incognito");
      assert.equal(h.posts[0]!.activeGenerations, h.active);
      assert.equal(h.posts[0]!.queuedMessages, h.queued);
      assert.equal(h.config.historyEnabled, true);
      await h.resolve("stop");
      assert.equal(h.config.historyEnabled, false);
      assert.equal(h.results[0]!.status, "success");
    });
  }

  test("cancelling a transition preserves the mode and active work", async () => {
    const h = harness(); h.active = 1;
    await h.request(false); await h.resolve("cancel");
    assert.deepEqual(h.events, ["begin:enter-incognito", "historyTransitionRequired", "cancel"]);
    assert.equal(h.results[0]!.status, "cancelled");
    assert.equal(h.config.historyEnabled, true);
  });

  test("ignores wrong request IDs, views and decisions while retaining the pending prompt", async () => {
    const h = harness(); h.active = 1;
    await h.request(false);
    await h.controller.resolve("other", "stop", h.view);
    await h.controller.resolve("request", "stop", {} as vscode.WebviewView);
    await h.resolve("save");
    assert.equal(h.results.length, 0);
    await h.resolve("stop");
    assert.equal(h.results[0]!.status, "success");
  });

  test("view recreation cancels a pending prompt and old replies cannot apply it", async () => {
    const h = harness(); h.active = 1;
    h.controller.handleWebviewRecreation();
    await h.request(false); h.controller.handleWebviewRecreation();
    await h.resolve("stop");
    assert.equal(h.results.length, 0);
    assert.equal(h.config.historyEnabled, true);
    assert.equal(h.events.filter((e) => e === "cancel").length, 1);
  });

  test("exiting with active work stops it before asking whether to save private messages", async () => {
    const h = harness(); h.active = 1; h.privateMessages = true; h.config.historyEnabled = false;
    await h.request(true); await h.resolve("stop");
    assert.deepEqual(h.events, ["begin:exit-incognito", "historyTransitionRequired", "stop", "phase:exit-incognito", "historyTransitionRequired"]);
    assert.equal(h.posts[1]!.phase, "exit-incognito");
    assert.equal(h.config.historyEnabled, false);
    await h.resolve("stop");
    assert.equal(h.results.length, 0);
    await h.resolve("save");
    assert.equal(h.config.historyEnabled, true);
    assert.ok(h.events.includes("promote"));
  });

  for (const decision of ["save", "discard"] as const) {
    test(`exits incognito with the user's ${decision} decision`, async () => {
      const h = harness(); h.config.historyEnabled = false; h.privateMessages = true;
      await h.request(true);
      assert.equal(h.config.historyEnabled, false);
      await h.resolve(decision);
      assert.equal(h.config.historyEnabled, true);
      assert.deepEqual(h.events.slice(-2), ["save", decision === "save" ? "promote" : "discard"]);
      assert.equal(h.results[0]!.status, "success");
    });
  }

  test("exits immediately when there are no private messages", async () => {
    const h = harness(); h.config.historyEnabled = false;
    await h.request(true);
    assert.deepEqual(h.events, ["begin:exit-incognito", "save", "discard"]);
    assert.equal(h.results[0]!.status, "success");
  });

  test("a reset uses defaults instead of saving a partial configuration", async () => {
    const h = harness(); h.config.historyEnabled = false;
    await h.request(true, "reset");
    assert.deepEqual(h.events, ["begin:exit-incognito", "reset", "discard"]);
    assert.equal(h.config.historyEnabled, true);
  });

  test("an entry persistence error does not switch chat state", async () => {
    const h = harness(); h.saveFails = true;
    await h.request(false);
    assert.deepEqual(h.events, ["begin:enter-incognito", "save", "cancel"]);
    assert.equal(h.config.historyEnabled, true);
    assert.equal(h.results[0]!.status, "error");
  });

  test("a failed promotion restores incognito mode and reports the failure", async () => {
    const h = harness(); h.config.historyEnabled = false; h.privateMessages = true; h.promotionFails = true;
    await h.request(true); await h.resolve("save");
    assert.equal(h.config.historyEnabled, false);
    assert.deepEqual(h.events.slice(-4), ["save", "promote", "save", "cancel"]);
    assert.equal(h.results[0]!.status, "error");
    assert.match(h.results[0]!.error!, /promotion failed/);
  });

  test("still reports an exit failure when restoring the disabled setting also fails", async () => {
    const h = harness(); h.config.historyEnabled = false; h.privateMessages = true; h.saveFails = true;
    await h.request(true); await h.resolve("discard");
    assert.equal(h.results[0]!.status, "error");
    assert.ok(!h.events.includes("discard"));
  });

  test("a repeated decision cannot promote messages twice while promotion is pending", async () => {
    const h = harness(); h.config.historyEnabled = false; h.privateMessages = true;
    let release!: () => void;
    h.chat.promoteIncognito = async () => { h.events.push("promote"); await new Promise<void>((resolve) => { release = resolve; }); };
    await h.request(true);
    const first = h.resolve("save");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await h.resolve("save"); release(); await first;
    assert.equal(h.events.filter((e) => e === "promote").length, 1);
    assert.equal(h.results.length, 1);
    await h.resolve("save");
    assert.equal(h.results.length, 1);
  });
});

function harness() {
  const config = { ...DEFAULT_CONFIG };
  const events: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  const results: Array<{ status: string; error?: string }> = [];
  const state = { active: 0, queued: 0, busy: false, privateMessages: false, saveFails: false, promotionFails: false };
  const settings = {
    load: () => config, getRevision: () => 1,
    save: async (patch: Partial<AppConfig>) => { events.push("save"); if (state.saveFails) { throw new Error("save failed"); } Object.assign(config, patch); },
    reset: async () => { events.push("reset"); Object.assign(config, DEFAULT_CONFIG); },
  } as SettingsRepository;
  const chat = {
    beginHistoryTransition: (_id: string, direction: string) => { events.push(`begin:${direction}`); return state.busy ? undefined : { activeGenerations: state.active, queuedMessages: state.queued }; },
    cancelHistoryTransition: () => { events.push("cancel"); },
    hasIncognitoMessages: () => state.privateMessages,
    setHistoryTransitionPhase: (phase: string) => { events.push(`phase:${phase}`); },
    enterIncognito: async () => { events.push("enter"); },
    promoteIncognito: async () => { events.push("promote"); if (state.promotionFails) { throw new Error("promotion failed"); } },
    discardIncognito: () => { events.push("discard"); },
    stopPendingWork: async () => { events.push("stop"); },
  };
  const view = { webview: { postMessage: async (p: Record<string, unknown>) => { events.push(p.type as string); posts.push(p); return true; } } } as unknown as vscode.WebviewView;
  const controller = new HistoryTransitionController({ chatHandler: chat as unknown as ChatHandler, settings,
    postUpdateResult: async (_view, _request, _operation, status, error) => { results.push({ status, error }); } });
  return Object.assign(state, { config, events, posts, results, view, controller, chat,
    request: (enabled: boolean, operation: "save" | "reset" = "save") => controller.request({ requestId: "request", operation, targetEnabled: enabled, config: { historyEnabled: enabled }, webviewView: view }),
    resolve: (decision: "stop" | "save" | "discard" | "cancel") => controller.resolve("request", decision, view),
  });
}

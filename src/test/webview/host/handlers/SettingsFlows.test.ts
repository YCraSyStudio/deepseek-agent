import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG, type AppConfig } from "@/contracts";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import type { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";
import { SettingsHandler } from "@/vscode/webviews/handlers/SettingsHandler";
import { watchCustomizationFiles } from "@/vscode/configuration/CustomizationFiles";
import { dialogs, env, FileSystemError, hostEvents, hostState, resetVsCodeMock, Uri, window, workspace } from "../../../support/VsCodeMock";

type Message = Parameters<SettingsHandler["handle"]>[0];

suite("settings storage and customization characterization", () => {
  let directory: string;
  let project: string;
  let savedEnv: { mode?: string; data?: string };
  setup(async () => {
    resetVsCodeMock();
    directory = await mkdtemp(path.join(tmpdir(), "deepseek-settings-flows-"));
    project = path.join(directory, "project"); await mkdir(project);
    savedEnv = { mode: process.env.NODE_ENV, data: process.env.DEEPSEEK_AGENT_USER_DATA_DIR };
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(directory, "data");
  });
  teardown(async () => {
    resetVsCodeMock();
    if (savedEnv.mode === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = savedEnv.mode; }
    if (savedEnv.data === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; } else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = savedEnv.data; }
    await rm(directory, { recursive: true, force: true });
  });
  function folder() { return { uri: Uri.file(project), name: "Project" }; }

  test("lists local instruction files, omits remote roots and identifies the active root", async () => {
    const h = harness(); const local = folder();
    await writeFile(path.join(project, "AGENTS.md"), "existing");
    workspace.workspaceFolders = [local, { uri: { scheme: "vscode-remote", fsPath: "/remote", toString: () => "remote://root" }, name: "Remote" }];
    window.activeTextEditor = { document: { uri: Uri.file(path.join(project, "index.ts")) } };
    await h.send({ type: "getWorkspaceInstructions" }, "workspaceInstructions");
    assert.deepEqual(h.last("workspaceInstructions"), { type: "workspaceInstructions", roots: [{ uri: local.uri.toString(), name: "Project", exists: true }], preferredRootUri: local.uri.toString() });
  });

  test("reports an empty root list without an open workspace", async () => {
    const h = harness(); await h.send({ type: "getWorkspaceInstructions" }, "workspaceInstructions");
    assert.deepEqual(h.last("workspaceInstructions").roots, []);
  });

  for (const reason of ["FileNotFound", "ENOENT"] as const) {
    test(`treats ${reason} as a missing instruction file`, async () => {
      const h = harness(); workspace.workspaceFolders = [folder()];
      hostState.stat = async () => { throw reason === "FileNotFound" ? new FileSystemError(reason) : Object.assign(new Error(reason), { code: reason }); };
      await h.send({ type: "getWorkspaceInstructions" }, "workspaceInstructions");
      assert.equal((h.last("workspaceInstructions").roots as Array<{ exists: boolean }>)[0]!.exists, false);
      assert.equal(h.last("workspaceInstructions").error, undefined);
    });
  }

  test("a directory named AGENTS.md is not advertised as an instruction file", async () => {
    const h = harness(); workspace.workspaceFolders = [folder()]; await mkdir(path.join(project, "AGENTS.md"));
    await h.send({ type: "getWorkspaceInstructions" }, "workspaceInstructions");
    assert.equal((h.last("workspaceInstructions").roots as Array<{ exists: boolean }>)[0]!.exists, false);
  });

  test("reports filesystem errors instead of claiming an instruction file is missing", async () => {
    const h = harness(); workspace.workspaceFolders = [folder()];
    hostState.stat = async () => { throw new Error("permission denied"); };
    await h.send({ type: "getWorkspaceInstructions" }, "workspaceInstructions");
    assert.match(h.last("workspaceInstructions").error as string, /permission denied/);
    assert.deepEqual(h.last("workspaceInstructions").roots, []);
  });

  for (const fails of [false, true]) {
    test(`ignores an outdated instruction scan when a newer scan finishes first, old scan fails=${fails}`, async () => {
      const h = harness(); workspace.workspaceFolders = [folder()];
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      hostState.stat = async () => { await waiting; if (fails) { throw new Error("old error"); } return { type: 1 }; };
      h.handler.handle({ type: "getWorkspaceInstructions" }, h.view);
      workspace.workspaceFolders = [];
      await h.send({ type: "getWorkspaceInstructions" }, "workspaceInstructions");
      release(); await tick();
      assert.equal(h.posts.filter((p) => p.type === "workspaceInstructions").length, 1);
      assert.deepEqual(h.last("workspaceInstructions").roots, []);
    });
  }

  for (const locale of ["es", "auto"] as const) {
    test(`creates and opens the selected workspace instructions in locale ${locale}`, async () => {
      const h = harness(); workspace.workspaceFolders = [folder()]; h.config.interfaceLanguage = locale; env.language = "zh";
      await h.send({ type: "openWorkspaceInstructions", requestId: "open", rootUri: folder().uri.toString() }, "openWorkspaceInstructionsResult");
      assert.equal(h.last("openWorkspaceInstructionsResult").success, true);
      assert.equal(hostState.opened[0]!.fsPath, path.join(project, "AGENTS.md"));
      assert.match(await readFile(hostState.opened[0]!.fsPath, "utf8"), locale === "es" ? /Descripción del proyecto/ : /项目概述/);
      assert.equal(h.last("workspaceInstructions").error, undefined);
    });
  }

  test("rejects an instruction root that is no longer open", async () => {
    const h = harness();
    await h.send({ type: "openWorkspaceInstructions", requestId: "missing", rootUri: folder().uri.toString() }, "openWorkspaceInstructionsResult");
    assert.equal(h.last("openWorkspaceInstructionsResult").success, false);
    assert.equal(hostState.opened.length, 0);
  });

  test("opening instructions preserves existing contents", async () => {
    const h = harness(); workspace.workspaceFolders = [folder()]; await writeFile(path.join(project, "AGENTS.md"), "user rules");
    await h.send({ type: "openWorkspaceInstructions", requestId: "open", rootUri: folder().uri.toString() }, "openWorkspaceInstructionsResult");
    assert.equal(await readFile(path.join(project, "AGENTS.md"), "utf8"), "user rules");
  });

  test("reports an editor-opening failure", async () => {
    const h = harness(); workspace.workspaceFolders = [folder()]; hostState.openError = new Error("editor unavailable");
    await h.send({ type: "openWorkspaceInstructions", requestId: "open", rootUri: folder().uri.toString() }, "openWorkspaceInstructionsResult");
    assert.equal(h.last("openWorkspaceInstructionsResult").success, false);
    assert.match(h.last("openWorkspaceInstructionsResult").error as string, /editor unavailable/);
  });

  test("global instructions wait for pending settings and require the feature to be enabled", async () => {
    const h = harness(); h.config.includeHomeAgents = false;
    await h.send({ type: "openGlobalAgents", requestId: "global" }, "openGlobalAgentsResult");
    assert.deepEqual(h.events, ["wait"]);
    assert.equal(h.last("openGlobalAgentsResult").success, false);
    assert.equal(hostState.opened.length, 0);
  });

  test("creates global instructions in the configured test data directory", async () => {
    const h = harness(); h.config.includeHomeAgents = true;
    await h.send({ type: "openGlobalAgents", requestId: "global" }, "openGlobalAgentsResult");
    assert.equal(h.last("openGlobalAgentsResult").success, true);
    assert.equal(hostState.opened[0]!.fsPath, path.join(directory, "data", "AGENTS.md"));
    assert.equal(await readFile(hostState.opened[0]!.fsPath, "utf8"), "");
  });

  test("stores a new directory and requests a reload before clients use it", async () => {
    const h = harness(); const target = path.join(directory, "selected");
    await h.send({ type: "setStorageDirectory", directory: target }, "storageDirectoryResult");
    assert.equal(h.globalState.get("storageDirectory"), target);
    const info = h.last("storageDirectoryResult").storageInfo as { configuredDirectory: string; directory: string };
    assert.equal(info.configuredDirectory, target); assert.equal(info.directory, path.join(directory, "data"));
    await h.send({ type: "reloadStorage" });
    assert.deepEqual(hostState.executed, ["workbench.action.reloadWindow"]);
  });

  test("selects a local directory through the picker", async () => {
    const h = harness(); hostState.selectedFolders = [Uri.file(path.join(directory, "picked"))];
    await h.send({ type: "selectStorageDirectory" }, "storageDirectoryResult");
    assert.equal(h.globalState.get("storageDirectory"), path.join(directory, "picked"));
  });

  for (const selected of [undefined, []]) {
    test(`cancelling the directory picker preserves the configured location, selection=${selected ? "empty" : "undefined"}`, async () => {
      const h = harness(); hostState.selectedFolders = selected;
      await h.send({ type: "selectStorageDirectory" }, "storageDirectoryResult");
      assert.equal(h.globalState.size, 0); assert.equal(h.last("storageDirectoryResult").error, undefined);
    });
  }

  test("rejects a remote directory selection", async () => {
    const h = harness(); hostState.selectedFolders = [{ scheme: "remote", fsPath: "/remote", toString: () => "remote://root" }];
    await h.send({ type: "selectStorageDirectory" }, "storageDirectoryResult");
    assert.match(h.last("storageDirectoryResult").error as string, /local directory/);
    assert.equal(h.globalState.size, 0);
  });

  test("reports an invalid storage directory without changing the setting", async () => {
    const h = harness(); await h.send({ type: "setStorageDirectory", directory: "relative/path" }, "storageDirectoryResult");
    assert.match(h.last("storageDirectoryResult").error as string, /absolute directory/); assert.equal(h.globalState.size, 0);
  });

  test("watches instructions and disposes watchers when the view is closed", async () => {
    const h = harness(); workspace.workspaceFolders = [folder()];
    const watcher = h.handler.watchWorkspaceInstructions(h.view);
    assert.equal(hostState.watchers.length, 1);
    hostState.watchers[0]!.changed.fire(); await h.wait("workspaceInstructions");
    assert.equal((h.last("workspaceInstructions").roots as unknown[]).length, 1);
    hostEvents.focus.fire({ focused: false }); assert.equal(hostState.watchers.length, 1);
    hostEvents.focus.fire({ focused: true }); await tick(); assert.equal(hostState.watchers.length, 2);
    hostEvents.folders.fire(); await tick(); assert.equal(hostState.watchers.length, 3);
    hostEvents.visibility.fire(); await tick();
    watcher.dispose(); assert.ok(hostState.watchers.every((w) => w.disposed));
  });

  test("customization watchers rebind when the parent file entry changes", async () => {
    const h = harness(); let refreshes = 0;
    const watcher = watchCustomizationFiles(h.view, () => [{ directory: folder().uri as vscode.Uri, pattern: "*.md", parent: { directory: Uri.file(directory) as vscode.Uri, name: "project" } }], () => refreshes++);
    assert.equal(hostState.watchers.length, 2);
    hostState.watchers[1]!.created.fire();
    assert.equal(refreshes, 1); assert.equal(hostState.watchers.length, 4);
    hostState.watchers[2]!.deleted.fire(); assert.equal(refreshes, 2);
    Object.assign(h.view, { visible: false }); hostEvents.visibility.fire(); assert.equal(refreshes, 2);
    Object.assign(h.view, { visible: true }); hostEvents.visibility.fire(); assert.equal(refreshes, 3);
    watcher.dispose(); assert.ok(hostState.watchers.every((w) => w.disposed));
  });

  test("an unchanged history toggle saves normally without starting a transition", async () => {
    const h = harness(); await h.send({ type: "saveConfig", requestId: "same", config: { historyEnabled: true } }, "configUpdateResult");
    assert.equal(h.last("configUpdateResult").status, "success");
    assert.deepEqual(h.events, ["save"]);
  });

  test("changing history is delegated through the transition controller and its response", async () => {
    const h = harness(); await h.send({ type: "saveConfig", requestId: "private", config: { historyEnabled: false } }, "configUpdateResult");
    assert.equal(h.config.historyEnabled, false); assert.ok(h.events.includes("enter"));
    assert.equal(h.last("configUpdateResult").status, "success");
    h.handler.handleWebviewRecreation();
  });

  test("resetting from incognito goes through the same transition and retains secrets", async () => {
    const h = harness(); h.config.historyEnabled = false; h.config.baseUrl = "https://other.example"; dialogs.warning = "Reset settings";
    await h.send({ type: "resetConfig", requestId: "reset" }, "configUpdateResult");
    assert.equal(h.config.historyEnabled, true); assert.ok(h.events.includes("discard"));
    assert.equal(h.last("configUpdateResult").operation, "reset");
    assert.match(JSON.stringify(dialogs.warnings), /other.example/);
  });
});

async function tick() { for (let i = 0; i < 8; i++) { await new Promise<void>((resolve) => setImmediate(resolve)); } }
function harness() {
  const config = { ...DEFAULT_CONFIG };
  const events: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  const globalState = new Map<string, unknown>();
  const settings = { load: () => config, getRevision: () => 1, waitForPendingWrites: async () => { events.push("wait"); },
    save: async (patch: Partial<AppConfig>) => { events.push("save"); Object.assign(config, patch); },
    reset: async () => { events.push("reset"); Object.assign(config, DEFAULT_CONFIG); },
  } as SettingsRepository;
  const secrets = { getApiKey: async () => undefined, migrateLegacyApiKey: async () => undefined } as unknown as SecretStore;
  const chat = { beginHistoryTransition: () => ({ activeGenerations: 0, queuedMessages: 0 }),
    hasIncognitoMessages: () => false, enterIncognito: async () => { events.push("enter"); }, discardIncognito: () => { events.push("discard"); } } as unknown as ChatHandler;
  const context = { globalState: { get: (key: string) => globalState.get(key), update: async (key: string, value: unknown) => { globalState.set(key, value); } } } as unknown as vscode.ExtensionContext;
  const view = { visible: true, onDidChangeVisibility: hostEvents.visibility.event,
    webview: { postMessage: async (post: Record<string, unknown>) => { posts.push(post); return true; } } } as unknown as vscode.WebviewView;
  const handler = new SettingsHandler(context, chat, settings, secrets, {} as ModelProviderFactory);
  const wait = async (type: string, count = 1) => {
    const deadline = Date.now() + 2000;
    while (posts.filter((post) => post.type === type).length < count) {
      if (Date.now() > deadline) { assert.fail(`Missing ${type}: ${JSON.stringify(posts)}`); }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  return { config, events, posts, globalState, handler, view, wait,
    async send(message: Message, expected?: string) { const count = posts.filter((post) => post.type === expected).length; handler.handle(message, view); if (expected) { await wait(expected, count + 1); } else { await tick(); } },
    last(type: string) { const post = [...posts].reverse().find((p) => p.type === type); assert.ok(post, `Missing ${type}`); return post; },
  };
}

import type { ReusableInstruction } from "@/contracts/Customization";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { DEFAULT_CONFIG } from "@/contracts";
import type { SettingsRepository } from "@/application/ports";
import { ReusableInstructionsHandler } from "@/vscode/webviews/handlers/ReusableInstructionsHandler";
import { hostEvents, hostState, resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("reusable instructions host workflow", () => {
  let root: string; let oldMode: string | undefined; let oldData: string | undefined;
  let handler: ReusableInstructionsHandler; let view: vscode.WebviewView;
  let posts: Array<Record<string, unknown>>; let language: string;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "instruction-handler-"));
    oldMode = process.env.NODE_ENV; oldData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(root, "data");
    posts = []; language = "auto";
    handler = new ReusableInstructionsHandler({ load: () => ({ ...DEFAULT_CONFIG, interfaceLanguage: language }) } as SettingsRepository);
    view = { visible: true, onDidChangeVisibility: hostEvents.visibility.event,
      webview: { postMessage: async (message: Record<string, unknown>) => { posts.push(message); return true; } } } as unknown as vscode.WebviewView;
  });
  teardown(async () => {
    resetVsCodeMock();
    for (const [key, value] of [["NODE_ENV", oldMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", oldData]]) {
      if (value === undefined) { delete process.env[key!]; } else { process.env[key!] = value; }
    }
    await rm(root, { recursive: true, force: true });
  });
  const catalog = () => posts.filter(post => post.type === "reusableInstructions").at(-1)!;
  const result = () => posts.filter(post => post.type === "reusableInstructionResult").at(-1)!;
  async function create(scope: "global" | "workspace", rootUri?: string) {
    await handler.handle({ type: "createReusableInstruction", requestId: "create", scope, rootUri,
      name: "review", description: "Review before committing", template: "blank" }, view);
  }
  test("creates a global instruction, opens the actual file and refreshes the catalog", async () => {
    await create("global");
    assert.deepEqual(result(), { type: "reusableInstructionResult", requestId: "create", success: true });
    const entries = catalog().entries as ReusableInstruction[];
    assert.equal(entries[0].name, "review"); assert.equal(entries[0].scope, "global");
    assert.equal(hostState.opened[0].fsPath, path.join(root, "data/instructions/review.md"));
    assert.match(await readFile(hostState.opened[0].fsPath, "utf8"), /Review before committing/);
    await handler.handle({ type: "openReusableInstruction", requestId: "open", id: entries[0].id }, view);
    assert.equal(result().success, true); assert.equal(result().requestId, "open"); assert.equal(hostState.opened.length, 2);
  });
  test("creates in the selected open workspace with an explicit language", async () => {
    const directory = path.join(root, "project"); await mkdir(directory); language = "es";
    const uri = Uri.file(directory); workspace.workspaceFolders = [{ uri, name: "project" }];
    await create("workspace", uri.toString());
    assert.equal(result().success, true);
    assert.equal(hostState.opened[0].fsPath, path.join(directory, "instructions/review.md"));
    assert.equal((catalog().entries as ReusableInstruction[])[0].rootUri, uri.toString());
  });
  test("rejects a closed workspace and unknown instructions with correlated results", async () => {
    await create("workspace", "file:///closed");
    assert.equal(result().success, false); assert.match(String(result().error), /currently open/);
    await handler.handle({ type: "openReusableInstruction", requestId: "missing", id: "unknown:review" }, view);
    assert.equal(result().success, false); assert.equal(result().requestId, "missing");
    assert.equal(hostState.opened.length, 0);
  });
  test("reports editor failures while keeping the successfully created file in the catalog", async () => {
    hostState.openError = new Error("editor failed"); await create("global");
    assert.equal(result().success, false); assert.match(String(result().error), /editor failed/);
    assert.equal((catalog().entries as ReusableInstruction[]).length, 1);
  });
  test("only publishes the latest concurrent catalog, including catalog errors", async () => {
    const refresh = () => handler.handle({ type: "getReusableInstructions" }, view);
    await Promise.all([refresh(), refresh()]); assert.equal(posts.length, 1);
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "data/instructions"), "not a directory"); posts = [];
    await Promise.all([refresh(), refresh()]);
    assert.equal(posts.length, 1); assert.deepEqual(catalog().entries, []);
    assert.match(String(catalog().error), /ordinary directories/);
  });
  test("watches global and workspace instruction files and disposes refresh subscriptions", async () => {
    const directory = path.join(root, "project"); await mkdir(directory);
    workspace.workspaceFolders = [{ uri: Uri.file(directory), name: "project" }];
    const subscription = handler.watch(view);
    assert.equal(hostState.watchers.length, 4);
    assert.deepEqual(hostState.watchers.map(watcher => watcher.pattern.pattern), ["*.md", "instructions", "*.md", "instructions"]);
    hostState.watchers[0].changed.fire();
    for (let i = 0; i < 100 && posts.length === 0; i++) { await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.equal(catalog().type, "reusableInstructions");
    subscription.dispose(); const count = posts.length; hostState.watchers[0].changed.fire();
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(posts.length, count);
    assert.equal(hostState.watchers.every(watcher => watcher.disposed), true);
  });
});

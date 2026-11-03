import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import type { SettingsRepository } from "@/application/ports";
import { DEFAULT_CONFIG } from "@/contracts";
import { ChatDraftHandler } from "@/vscode/webviews/handlers/ChatDraftHandler";

suite("chat draft host workflow", () => {
  let root: string; let mode: string | undefined; let data: string | undefined;
  let historyEnabled: boolean; let handler: ChatDraftHandler; let posts: Array<Record<string, unknown>>; let view: vscode.WebviewView;
  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "draft-handler-")); mode = process.env.NODE_ENV; data = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = root; historyEnabled = true; posts = [];
    handler = new ChatDraftHandler({ load: () => ({ ...DEFAULT_CONFIG, historyEnabled }) } as SettingsRepository);
    view = { webview: { postMessage: async (message: Record<string, unknown>) => { posts.push(message); return true; } } } as unknown as vscode.WebviewView;
  });
  teardown(async () => {
    if (mode === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = mode; }
    if (data === undefined) { delete process.env.DEEPSEEK_AGENT_USER_DATA_DIR; } else { process.env.DEEPSEEK_AGENT_USER_DATA_DIR = data; }
    await rm(root, { recursive: true, force: true });
  });
  const draft = { draft: "Unsent text", referencedFiles: [], imageAttachments: [] };
  test("persists and restores draft text with correlated result identifiers", async () => {
    await handler.handle({ type: "chatDraft", requestId: "write", operation: "write", conversationId: "chat", draft }, view);
    await handler.handle({ type: "chatDraft", requestId: "read", operation: "read", conversationId: "chat" }, view);
    assert.equal(posts[0].type, "chatDraftResult"); assert.equal(posts[0].requestId, "write");
    assert.equal(posts[1].requestId, "read"); assert.deepEqual(posts[1].draft, draft);
  });
  test("blocks persistence in incognito while permitting removal of previously saved drafts", async () => {
    await handler.handle({ type: "chatDraft", requestId: "write", operation: "write", draft }, view);
    historyEnabled = false;
    for (const operation of ["read", "write"] as const) {
      await handler.handle({ type: "chatDraft", requestId: operation, operation, draft }, view);
      assert.match(String(posts.at(-1)?.error), /disabled in incognito mode/);
    }
    await handler.handle({ type: "chatDraft", requestId: "delete", operation: "delete" }, view);
    assert.deepEqual(posts.at(-1), { type: "chatDraftResult", requestId: "delete" });
    historyEnabled = true; await handler.handle({ type: "chatDraft", requestId: "empty", operation: "read" }, view);
    assert.equal(posts.at(-1)?.draft, undefined);
  });
  test("returns a scoped error for invalid storage requests", async () => {
    await handler.handle({ type: "chatDraft", requestId: "invalid", operation: "read", conversationId: "../outside" }, view);
    assert.equal(posts[0].requestId, "invalid"); assert.match(String(posts[0].error), /Invalid draft request/);
  });
});

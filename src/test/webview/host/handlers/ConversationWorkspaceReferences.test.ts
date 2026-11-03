import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ConversationWorkspaceReferences } from "@/vscode/webviews/handlers/chat/session/ConversationWorkspaceReferences";
import { ConversationState } from "@/application/chat/ConversationState";
import type { HistoryManager } from "@/vscode/storage";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import type { ReferencedFile } from "@/contracts";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import { resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("conversation workspace reference ownership", () => {
  let root: string; let state: ConversationState; let references: ConversationWorkspaceReferences;
  let stored: StoredConversation | undefined; let reads: number; let posts: Array<Record<string, unknown>>;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "workspace-references-")); await writeFile(path.join(root, "file.ts"), "source");
    workspace.workspaceFolders = [{ name: "Project", uri: Uri.file(root) }];
    state = new ConversationState({ save: async () => undefined }); stored = undefined; reads = 0; posts = [];
    references = new ConversationWorkspaceReferences({ conversationState: state,
      historyManager: { getById: async () => { reads++; return stored; } } as unknown as HistoryManager,
      post: message => { posts.push(message); } });
  });
  teardown(async () => { resetVsCodeMock(); await rm(root, { recursive: true, force: true }); });
  const external = (id: string): ReferencedFile => ({ path: "external.ts", name: "external.ts", type: "file", scope: "external-snapshot", referenceId: id, content: `saved ${id}` });
  function conversation(id: string): StoredConversation {
    const workspaceBinding = captureCurrentWorkspaceBinding();
    return { schemaVersion: 2, id, title: "Saved", createdAt: 1, updatedAt: 1, model: "deepseek-flash", messages: [], workspaceBinding, workspaceUri: workspaceBinding.uri };
  }
  test("prefers selected then stored bindings, and falls back to the current workspace", async () => {
    const selected = conversation("selected"); state.load(selected);
    assert.deepEqual(await references.getBinding("selected"), selected.workspaceBinding); assert.equal(reads, 0);
    stored = conversation("stored"); stored.workspaceBinding = { ...stored.workspaceBinding, revision: "stored-revision" };
    assert.equal((await references.getBinding("stored")).revision, "stored-revision"); assert.equal(reads, 1);
    stored = undefined; assert.deepEqual(await references.getBinding("missing"), captureCurrentWorkspaceBinding());
    assert.deepEqual(await references.getBinding(), captureCurrentWorkspaceBinding()); assert.equal(reads, 2);
  });
  test("normalizes local references, records their binding and refuses stale or escaping paths", async () => {
    const binding = captureCurrentWorkspaceBinding(); const input: ReferencedFile = { path: "file.ts", name: "file.ts", type: "file", content: "source" };
    const result = await references.validateFiles([input], binding);
    assert.equal(result?.[0].scope, "workspace"); assert.equal(result?.[0].bindingRevision, binding.revision);
    assert.match(result![0].path, /^\.\//); assert.match(result![0].path, /file\.ts$/); assert.equal(input.scope, undefined);
    await assert.rejects(references.validateFiles([{ ...input, bindingRevision: "old" }], binding), /stale/);
    await assert.rejects(references.validateFiles([{ ...input, path: "../outside" }], binding), /traversal/i);
    assert.equal(await references.validateFiles([], binding), undefined); assert.equal(await references.validateFiles(undefined, binding), undefined);
  });
  test("uses the registered immutable external snapshot once instead of trusting the submitted payload", async () => {
    const file = external("chosen"); references.registerExternalContextFiles([file]); file.content = "changed after selection";
    const [accepted] = (await references.validateFiles([{ ...external("chosen"), path: "forged", content: "forged" }], captureCurrentWorkspaceBinding()))!;
    assert.equal(accepted.content, "saved chosen"); assert.equal(accepted.path, "external.ts");
    await assert.rejects(references.validateFiles([external("chosen")], captureCurrentWorkspaceBinding()), /selected again/);
  });
  test("evicts the oldest snapshots at the fifty-entry bound and clears retained snapshots", async () => {
    references.registerExternalContextFiles(Array.from({ length: 51 }, (_, index) => external(`item-${index}`)));
    const binding = captureCurrentWorkspaceBinding();
    await assert.rejects(references.validateFiles([external("item-0")], binding), /selected again/);
    assert.equal((await references.validateFiles([external("item-50")], binding))![0].content, "saved item-50");
    references.clear(); await assert.rejects(references.validateFiles([external("item-1")], binding), /selected again/);
  });
  test("does not register incomplete or non-external snapshots and publishes current context", async () => {
    const file = external("invalid"); references.registerExternalContextFiles([{ ...file, scope: "workspace" }, { ...file, content: undefined }, { ...file, referenceId: undefined }]);
    const binding = captureCurrentWorkspaceBinding();
    await assert.rejects(references.validateFiles([file], binding), /selected again/);
    await assert.rejects(references.validateFiles([{ ...file, referenceId: undefined }], binding), /selected again/);
    references.postContext(binding); assert.equal(posts[0].type, "workspaceContextChanged");
    assert.equal((posts[0].context as { state: string }).state, "connected");
  });
});

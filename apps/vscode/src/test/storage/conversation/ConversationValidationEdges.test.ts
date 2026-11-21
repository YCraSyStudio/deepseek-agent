import assert from "node:assert/strict";
import { isConversation, isWorkspaceBinding } from "@/application/chat/ConversationValidation";

suite("persisted conversation validation edges", () => {
  const folder = { uri: "file:///workspace", name: "Workspace", alias: "workspace", scheme: "file" };
  const binding = { schemaVersion: 1, uri: folder.uri, name: folder.name, revision: "revision", folders: [folder], capabilities: { files: true, search: true, git: true, terminal: true } };
  const conversation = { schemaVersion: 2, id: "chat", title: "Chat", model: "model", createdAt: 1, updatedAt: 1, workspaceUri: folder.uri, workspaceBinding: binding, messages: [] };
  const message = { id: "assistant", role: "assistant", content: "Answer" };
  const acceptsMessage = (patch: Record<string, unknown>) => isConversation({ ...conversation, messages: [{ ...message, ...patch }] });
  test("rejects malformed workspace bindings and capability records", () => {
    assert.equal(isWorkspaceBinding(binding), true);
    for (const value of [null, { ...binding, schemaVersion: 2 }, { ...binding, revision: "x".repeat(129) },
      { ...binding, folders: {} }, { ...binding, folders: Array(129).fill(folder) }, { ...binding, folders: [null] },
      { ...binding, folders: [{ ...folder, alias: 1 }] }, { ...binding, capabilities: null },
      ...["files", "search", "git", "terminal"].map(key => ({ ...binding, capabilities: { ...binding.capabilities, [key]: 1 } }))]) {
      assert.equal(isWorkspaceBinding(value), false); assert.equal(isConversation({ ...conversation, workspaceBinding: value }), false);
    }
  });
  test("validates reassignment history, timestamps and conversation limits", () => {
    const rebinding = { fromWorkspaceUri: "file:///old", toWorkspaceUri: folder.uri, at: 1 };
    assert.equal(isConversation({ ...conversation, workspaceRebindings: [rebinding] }), true);
    for (const workspaceRebindings of [{}, Array(101).fill(rebinding), [null], [{ ...rebinding, fromWorkspaceUri: 1 }], [{ ...rebinding, at: -1 }]]) {
      assert.equal(isConversation({ ...conversation, workspaceRebindings }), false);
    }
    for (const patch of [{ createdAt: -1 }, { updatedAt: 1.5 }, { messages: {} }, { messages: Array(10001).fill(message) }]) {
      assert.equal(isConversation({ ...conversation, ...patch }), false);
    }
  });
  test("validates generation and tool identities without accepting unknown terminal states", () => {
    for (const generationStopReason of ["user_cancelled", "steered", "workspace_changed", "shutdown", "deleted", "history_transition"]) {
      assert.equal(acceptsMessage({ generationStopReason, generationStatus: "interrupted", generationId: "generation", createdAt: 0, toolCallId: "call", toolName: "lookup" }), true);
    }
    for (const patch of [{ createdAt: -1 }, { generationId: 1 }, { generationStatus: "unknown" }, { generationStopReason: "unknown" },
      { toolCallId: 1 }, { toolName: 1 }]) { assert.equal(acceptsMessage(patch), false); }
  });
  test("rejects malformed timeline and tool collection envelopes", () => {
    for (const timeline of [{}, Array(10001).fill({}), [null], [{ type: "content", id: 1, content: "text" }],
      [{ type: "tool-group", id: "group", round: 1, toolCallIds: Array(1001).fill("call") }]]) {
      assert.equal(acceptsMessage({ timeline }), false);
    }
    for (const toolCalls of [{}, Array(1001).fill({}), [null], [{ toolCallId: 1, toolName: "lookup", arguments: "{}", status: "completed" }]]) {
      assert.equal(acceptsMessage({ toolCalls }), false);
    }
  });
  test("checks stored tool results and confirmation metadata in completed conversations", () => {
    const tool = { toolCallId: "call", toolName: "lookup", arguments: "{}", status: "completed" };
    const danger = { requiresConfirmation: true, dangerLevel: "caution", warningMessage: "Review", command: "node --version", filePath: "file.txt", cwd: "/workspace", shell: "bash", beforeHash: "hash" };
    assert.equal(acceptsMessage({ toolCalls: [{ ...tool, result: "done", isError: false, round: 1, rejected: false, requiresConfirmation: false, dangerLevel: "caution", dangerConfirmed: true, dangerConfirmation: danger }] }), true);
    for (const patch of [{ result: 1 }, { isError: 1 }, { round: 0 }, { rejected: 1 }, { requiresConfirmation: 1 },
      { dangerLevel: "unknown" }, { dangerConfirmed: 1 }, { dangerConfirmation: null },
      { dangerConfirmation: { ...danger, beforeHash: 1 } }, { status: "unknown" }]) {
      assert.equal(acceptsMessage({ toolCalls: [{ ...tool, ...patch }] }), false);
    }
  });
  test("bounds stored image collections and rejects oversized or malformed attachments", () => {
    const image = { id: "image", fileId: "file-api-abc", name: "Image", mediaType: "image/png", size: 64 * 1024 * 1024,
      source: "picker", uploadedAt: 1, expiresAt: 2, apiBaseUrl: "https://api.deepseek.com", cacheFileName: "image.png" };
    assert.equal(acceptsMessage({ imageAttachments: [image] }), true);
    for (const imageAttachments of [{}, Array(601).fill(image), [null], [{ ...image, size: image.size + 1 }]]) {
      assert.equal(acceptsMessage({ imageAttachments }), false);
    }
  });
});

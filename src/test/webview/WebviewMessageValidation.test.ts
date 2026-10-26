import * as assert from "assert";
import { isWebviewToHandlerMessage } from "@/vscode/webviews/WebviewMessageValidation";

suite("webview message validation", () => {
  test("accepts every valid message shape", () => {
    const messages = [
      { type: "initializeProtocol", protocolVersion: 5 },
      { type: "getConfig" },
      { type: "getReusableInstructions" },
      { type: "createReusableInstruction", requestId: "instruction-dotted-name", scope: "global", name: "commit.txt", description: "When committing" },
      { type: "createReusableInstruction", requestId: "instruction-create", scope: "global", name: "commit.md", description: "When committing", template: "commit" },
      { type: "createReusableInstruction", requestId: "instruction-create", scope: "workspace", rootUri: "file:///project", name: "git", description: "When using Git", template: "git" },
      { type: "openReusableInstruction", requestId: "instruction-open", id: "global:commit" },
      { type: "openGlobalAgents", requestId: "customization-open" },
      { type: "getWorkspaceInstructions" },
      { type: "openWorkspaceInstructions", requestId: "workspace-open", rootUri: "file:///project" },
      { type: "getChatSuggestion", requestId: "suggest-1", prefix: "Write a function" },
      { type: "getChatSuggestion", requestId: "suggest-empty", prefix: "" },
      { type: "cancelChatSuggestion", requestId: "suggest-1" },
      { type: "saveConfig", requestId: "suggest-settings", config: { editorSuggestionsEnabled: true, chatSuggestionsEnabled: false } },
      { type: "selectStorageDirectory" },
      { type: "reloadStorage" },
      { type: "setStorageDirectory", directory: "~/.ycrasy-agent" },
      { type: "saveConfig", requestId: "config-1", config: { interfaceLanguage: "es", permissionMode: "auto-approve", temperature: 1, maxTokens: 384_000 } },
      { type: "saveConfig", requestId: "config-default", config: { permissionMode: "default" } },
      { type: "saveConfig", requestId: "config-web", config: { webSearchEnabled: false } },
      { type: "saveConfig", requestId: "config-region", config: { webSearchRegion: "ES" } },
      { type: "saveConfig", requestId: "config-privacy", config: { privacyMinimizeData: true, webSearchRegion: "auto" } },
      { type: "saveConfig", requestId: "config-beta", config: { betaFeaturesEnabled: true } },
      { type: "saveConfig", requestId: "config-currency", config: { usageBreakdown: true, usageCostCurrency: "cny" } },
      { type: "resetConfig", requestId: "config-2" },
      { type: "resolveHistoryTransition", requestId: "history-1", decision: "stop" },
      { type: "resolveHistoryTransition", requestId: "history-2", decision: "save" },
      { type: "resolveHistoryTransition", requestId: "history-3", decision: "discard" },
      { type: "resolveHistoryTransition", requestId: "history-4", decision: "cancel" },
      { type: "deleteApiKey", requestId: "credential-1" },
      { type: "testConnection", apiKey: "secret", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
      { type: "testConnection", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
      { type: "testConnection", baseUrl: "http://127.0.0.1:11434/v1", model: "local-model" },
      { type: "sendMessage", clientRequestId: "request-1", text: "hello", modelId: "deepseek-flash", reasoning: "high", conversationId: "conversation-1", referencedFiles: [{ path: "README.md", content: "text", type: "file" }] },
      { type: "steerGeneration", generationId: "generation-1", clientRequestId: "request-2", text: "guide", modelId: "deepseek-flash", reasoning: "high", conversationId: "conversation-1" },
      { type: "cancelGeneration", requestId: "cancel-1", generationId: "generation-1", conversationId: "conversation-1" },
      { type: "getGenerationSnapshot" },
      { type: "consumeRecoveredDraft", conversationId: "conversation-1", clientRequestId: "request-1" },
      { type: "copyCode", code: "const x = 1;" },
      { type: "insertCode", code: "const x = 1;" },
      { type: "selectModel", modelId: "deepseek-flash" },
      { type: "newConversation", requestId: "navigation-new" },
      { type: "getWorkspaceContext", requestId: "workspace-1", conversationId: "conversation-1" },
      { type: "rebindConversationWorkspace", conversationId: "conversation-1", workspaceRevision: "revision-1" },
      { type: "openConversationWorkspace", conversationId: "conversation-1" },
      { type: "selectAttachments", requestId: "attachments-1", conversationId: "conversation-1" },
      { type: "uploadClipboardImage", requestId: "clipboard-1", name: "pasted.png", mediaType: "image/png", size: 3, dataBase64: "AAAA" },
      {
        type: "deleteImageAttachment",
        requestId: "image-delete-1",
        attachment: {
          id: "image-1",
          imageNumber: 4,
          fileId: "file-api-abc123",
          name: "screenshot.png",
          mediaType: "image/png",
          size: 1024,
          source: "picker",
          uploadedAt: 1,
          expiresAt: 2,
          apiBaseUrl: "https://api.deepseek.com",
          cacheFileName: "image-1.png",
          previewUri: "https://example.invalid/image.png",
        },
      },
      { type: "getHistory" },
      { type: "loadConversation", requestId: "navigation-load", id: "conversation-1" },
      { type: "loadConversationPage", requestId: "navigation-page", id: "conversation-1", cursor: "opaque-cursor" },
      { type: "deleteConversation", id: "conversation-1" },
      { type: "executeToolCall", generationId: "generation-1", toolCallId: "call-1", action: "execute" },
      { type: "getPathCompletions", requestId: 1, query: "./src/", conversationId: "conversation-1", workspaceRevision: "revision-1" },
      { type: "getAvailableTools" },
      { type: "getWorkspaceTurn", requestId: "turn-query", conversationId: "chat-1", generationId: "turn-1" },
      { type: "reviewWorkspaceTurn", requestId: "turn-review", conversationId: "chat-1", generationId: "turn-1" },
      { type: "revertWorkspaceTurn", requestId: "turn-revert", conversationId: "chat-1", generationId: "turn-1" },
      { type: "saveConfig", requestId: "snapshot-quota", config: { snapshotStorageLimitMb: 1024 } },
      { type: "openFile", path: "src/index.ts", line: 1 },
      { type: "openFileDiff", path: "src/index.ts", diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,1 +1,1 @@\n-old\n+new" },
      { type: "openFileDiff", path: "src/index.ts", afterHash: "a".repeat(64), beforeHash: "b".repeat(64), preview: false },
    ];

    for (const message of messages) {
      assert.strictEqual(isWebviewToHandlerMessage(message), true, JSON.stringify(message));
    }
  });

  test("rejects malformed, oversized and unexpected payloads", () => {
    const messages = [
      null,
      { type: "initializeProtocol", protocolVersion: 0 },
      { type: "initializeProtocol", protocolVersion: 5, injected: true },
      { type: "getConfig", injected: true },
      { type: "getChatSuggestion", requestId: "suggest-1", prefix: "x".repeat(12_001) },
      { type: "getChatSuggestion", requestId: "suggest-1", prefix: "a", apiKey: "injected" },
      { type: "cancelChatSuggestion" },
      { type: "selectStorageDirectory", directory: "/unexpected" },
      { type: "openGlobalAgents" },
      { type: "openGlobalAgents", requestId: "customization-open", path: "/unexpected/file" },
      { type: "setStorageDirectory", directory: "" },
      { type: "setStorageDirectory", directory: "x".repeat(4097) },
      { type: "setStorageDirectory", directory: 42 },
      { type: "resetConfig" },
      { type: "resolveHistoryTransition", requestId: "history", decision: "wait" },
      { type: "resolveHistoryTransition", decision: "cancel" },
      { type: "deleteApiKey" },
      { type: "deleteApiKey", requestId: "credential-1", injected: true },
      { type: "cancelGeneration", generationId: "generation-1" },
      { type: "cancelGeneration", requestId: "cancel-1", generationId: "generation-1" },
      { type: "newConversation" },
      { type: "loadConversation", id: "conversation-1" },
      { type: "loadConversationPage", id: "conversation-1" },
      { type: "getWorkspaceContext", conversationId: "conversation-1" },
      { type: "sendMessage", text: "", modelId: "model", reasoning: "high" },
      { type: "sendMessage", text: "hello", modelId: "model", reasoning: "invalid" },
      { type: "saveConfig", requestId: "legacy-enabled", config: { permissionMode: "enabled" } },
      { type: "saveConfig", requestId: "bad-1", config: { permissionMode: "root" } },
      { type: "saveConfig", requestId: "bad-workspace", config: { permissionMode: "workspace" } },
      { type: "saveConfig", requestId: "removed-read-only", config: { permissionMode: "read-only" } },
      { type: "saveConfig", requestId: "removed-custom", config: { permissionMode: "custom" } },
      { type: "saveConfig", requestId: "removed-matrix", config: { toolExecutionModes: { read_file: "enabled" } } },
      { type: "saveConfig", requestId: "bad-2", config: { temperature: Number.NaN } },
      { type: "saveConfig", requestId: "bad-3", config: { maxTokens: 384_001 } },
      { type: "saveConfig", requestId: "bad-4", config: { interfaceLanguage: "fr" } },
      { type: "saveConfig", requestId: "bad-currency", config: { usageCostCurrency: "eur" } },
      { type: "saveConfig", requestId: "bad-5", config: { responseFormat: "json_object" } },
      { type: "saveConfig", requestId: "bad-web", config: { webSearchEngine: "duckduckgo" } },
      { type: "saveConfig", requestId: "bad-searxng-http", config: { webSearchEngine: "searxng", searxngUrl: "http://search.example.com" } },
      { type: "saveConfig", requestId: "bad-searxng-creds", config: { webSearchEngine: "searxng", searxngUrl: "https://user:secret@search.example.com" } },
      { type: "saveConfig", requestId: "removed-visible-web", config: { webSearchBrowserVisible: true } },
      { type: "saveConfig", requestId: "removed-usage-budgets", config: { usageBudgets: { outputTokens: 1000 } } },
      { type: "testConnection", apiKey: "key", baseUrl: "file:///etc/passwd", model: "model" },
      { type: "testConnection", apiKey: "key", baseUrl: "http://api.deepseek.com", model: "model" },
      { type: "testConnection", apiKey: "key", baseUrl: "https://user:pass@api.deepseek.com", model: "model" },
      { type: "saveConfig", requestId: "bad-http", config: { baseUrl: "http://example.test" } },
      { type: "executeToolCall", toolCallId: "call", action: "force" },
      { type: "toolCallLimitDecision", generationId: "generation-1", action: "continue" },
      { type: "openFile", path: "file", line: 0 },
      { type: "openFileDiff", path: "file", diff: "x".repeat(2 * 1024 * 1024 + 1) },
      { type: "openFileDiff", path: "file", diff: "change", injected: true },
      { type: "revertWorkspaceTurn", requestId: "turn-revert", conversationId: "../other", generationId: "turn-1" },
      { type: "revertWorkspaceTurn", requestId: "turn-revert", conversationId: "chat-1", generationId: "../turn-1" },
      { type: "saveConfig", requestId: "snapshot-quota", config: { snapshotStorageLimitMb: 0 } },
      { type: "openFileDiff", path: "file" },
      { type: "openFileDiff", path: "file", diff: "change", preview: "yes" },
      { type: "copyCode", code: "x".repeat(2 * 1024 * 1024 + 1) },
      { type: "rebindConversationWorkspace", conversationId: "" },
      { type: "selectAttachments", requestId: "attachments-1", injected: true },
      { type: "selectAttachments", conversationId: "conversation-1" },
      { type: "sendMessage", clientRequestId: "large", text: "x".repeat(1024 * 1024 + 1), modelId: "model", reasoning: "high" },
      {
        type: "sendMessage",
        clientRequestId: "references",
        text: "hello",
        modelId: "model",
        reasoning: "high",
        referencedFiles: Array.from({ length: 51 }, (_, index) => ({ path: `file-${index}`, type: "file" })),
      },
    ];

    for (const message of messages) {
      assert.strictEqual(isWebviewToHandlerMessage(message), false, JSON.stringify(message)?.slice(0, 200));
    }
  });
});

 suite("workspace instructions request validation", () => {
  test("rejects missing fields and arbitrary extra paths", () => {
    for (const message of [
      { type: "getWorkspaceInstructions", path: "/outside" },
      { type: "openWorkspaceInstructions", rootUri: "file:///project" },
      { type: "openWorkspaceInstructions", requestId: "open" },
      { type: "openWorkspaceInstructions", requestId: "open", rootUri: "" },
      { type: "openWorkspaceInstructions", requestId: "open", rootUri: "file:///project", path: "/outside" },
    ]) {assert.equal(isWebviewToHandlerMessage(message), false);}
  });
});

suite("retired sync options validation", () => {
  test("rejects removed sync settings", () => {
    for (const key of ["syncSettingsWithVscode", "syncGlobalAgentsWithVscode"]) {
      assert.equal(isWebviewToHandlerMessage({ type: "saveConfig", requestId: "sync", config: { [key]: true } }), false);
    }
  });
});

suite("reusable instructions request validation", () => {
  test("rejects traversal, missing scope, malformed metadata and arbitrary target paths", () => {
    const valid = { type: "createReusableInstruction", requestId: "create", scope: "global", name: "commit", description: "When committing" };
    for (const patch of [{ template: "unknown" }, { template: "../outside" }, { name: "../outside" }, { name: "/tmp/file" }, { description: "line\nbreak" }, { scope: "other" }, { scope: "workspace" }, { rootUri: "file:///outside" }, { path: "/outside" }]) {
      assert.equal(isWebviewToHandlerMessage({ ...valid, ...patch }), false);
    }
    assert.equal(isWebviewToHandlerMessage({ type: "openReusableInstruction", id: "global:commit" }), false);
  });
});

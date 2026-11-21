import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type PermissionSnapshot } from "@/contracts";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { ToolCallSession } from "@/vscode/webviews/handlers/chat/toolCalls/ToolCallSession";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";

suite("Tool-call failure results", () => {
  const originalFetch = globalThis.fetch;
  teardown(() => {globalThis.fetch = originalFetch;});
  for (const partial of [false, true]) {
    test(`returns a persistable failure even with partial activity=${partial}`, async () => {
      let requests = 0;
      const registry = new ToolRegistry();
      registry.register({ definition: { type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } },
        metadata: { scope: "global", effect: "read-only", dangerLevel: "safe", requiresConfirmation: false }, handler: async () => "Read completed" });
      globalThis.fetch = async () => {
        requests++;
        if (partial && requests === 1) {
          return new Response('data: {"choices":[{"index":0,"delta":{"reasoning_content":"Inspecting the workspace","tool_calls":[{"index":0,"id":"read","type":"function","function":{"name":"read_file","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ error: { message: "Invalid request for test" } }, { status: 400 });
      };
      const snapshot: PermissionSnapshot = { revision: 1, permissionMode: "auto-approve", workspaceTrusted: true, fingerprint: "test" };
      const result = await new ToolCallSession(new ToolExecutor(registry)).run({
        messages: [{ role: "user", content: "Continue" }], tools: registry.getDefinitionsForAPI(), providerConfig: { ...DEFAULT_CONFIG, apiKey: "test" },
        eventSink: { publish: () => {} }, permissionSnapshot: snapshot, capturePermissionSnapshot: async () => snapshot,
        exposeReasoning: true, isCancelling: () => false, isWorkspaceTrusted: () => true, generationId: "failed", trustedUserRequest: "Continue", authorizedUserUrls: [],
        budgetManager: new GenerationBudgetManager(DEFAULT_CONFIG.model, DEFAULT_CONFIG.maxTokens),
      });
      assert.ok(result); assert.equal(result.partial, true);
      assert.match(result.error!, /Error en tool calls:.*HTTP 400/);
      if (partial) {assert.equal(result.toolCalls?.[0].status, "completed"); assert.ok(result.timeline.length);}
      else {assert.deepEqual(result.timeline, []);}
    });
  }
});

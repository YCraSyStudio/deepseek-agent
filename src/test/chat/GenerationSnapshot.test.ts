import assert from "node:assert/strict";
import { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import { buildGenerationSnapshot } from "@/vscode/webviews/handlers/chat/generation/GenerationCheckpointing";
import { acceptMessageForScope } from "@/ui/views/chatView/hooks/GenerationEventScope";
import type { HandlerToWebviewMessage } from "@/contracts";
import type { SendMessagePayload } from "@/vscode/webviews/handlers/chat/Types";
import type { GenerationRunRecord } from "@/vscode/webviews/handlers/chat/generation/GenerationRun";

suite("starting generation snapshots", () => {
  test("keeps the first accepted turn visible before its execution record exists", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {release = resolve;});
    const coordinator = new GenerationCoordinator<SendMessagePayload>({
      idGenerator: { next: () => "generation-first" }, getLimit: () => 1,
      run: async () => blocked,
    });
    coordinator.enqueue({ conversationId: "conversation-new", clientRequestId: "request-first", queuedAt: 123,
      payload: { clientRequestId: "request-first", text: "Describe this image", modelId: "deepseek-flash", reasoning: "off" } });
    try {
      const snapshot = buildGenerationSnapshot(new Map(), new Map(), coordinator) as Extract<HandlerToWebviewMessage, { type: "generationSnapshot" }>;
      assert.equal(snapshot.generations.length, 1);
      const active = snapshot.generations.find((run) => run.conversationId === "conversation-new");
      assert.equal(active?.status, "starting");
      assert.equal(active?.userMessage.content, "Describe this image");
      assert.ok(acceptMessageForScope({ type: "streamTimelineDelta", conversationId: "conversation-new",
        generationId: "generation-first", eventId: "answer", eventType: "content", content: "The image shows…" },
      { conversationId: "conversation-new", activeGenerationId: active?.generationId }));

      const record = { ...active, status: "streaming", content: "The image shows…" } as unknown as GenerationRunRecord;
      const running = buildGenerationSnapshot(new Map([["generation-first", record]]), new Map(), coordinator) as typeof snapshot;
      assert.equal(running.generations.length, 1);
      assert.equal(running.generations[0].status, "streaming");
      assert.equal(running.generations[0].content, "The image shows…");
    } finally {
      release();
      await coordinator.shutdown();
    }
  });
});

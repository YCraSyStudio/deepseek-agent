import assert from "node:assert/strict";
import { upsertUserTurn } from "@/ui/views/chatView/model/UserTurnUpdates";
import type { ConversationMessage } from "@/contracts";

suite("user turn updates", () => {
  test("replaces a starting snapshot with the actual user message without duplicating it", () => {
    const initial: ConversationMessage = { id: "starting-first", role: "user", content: "Describe", generationId: "first" };
    const assistant: ConversationMessage = { id: "answer", role: "assistant", content: "Streaming…", generationId: "first" };
    const updated = upsertUserTurn([initial, assistant], { ...initial, id: "persisted-user", content: "Describe this image" });
    assert.equal(updated.length, 2);
    assert.equal(updated[0].id, initial.id);
    assert.equal(updated[0].content, "Describe this image");
    assert.strictEqual(updated[1], assistant);
    assert.equal(initial.content, "Describe");
  });

  test("keeps identical prompts from separate generations as separate user turns", () => {
    const first: ConversationMessage = { id: "first", role: "user", content: "Describe", generationId: "first" };
    const second: ConversationMessage = { ...first, id: "second", generationId: "second" };
    assert.deepEqual(upsertUserTurn([first], second), [first, second]);
  });
});

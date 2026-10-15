import * as assert from "node:assert/strict";
import { encodeConversationMessage, decodeConversationMessage } from "@/vscode/storage/ConversationStorageCodec";
import type { StoredConversationMessage } from "@/application/chat/ProviderTranscript";

suite("conversation storage codec", () => {
  test("stores repeated final content once and restores timeline order", () => {
    const message: StoredConversationMessage = {
      id: "assistant", role: "assistant", content: "Respuesta final", contextContent: "Respuesta final",
      imageAttachments: [], toolCalls: [],
      timeline: [
        { id: "thought", type: "reasoning", content: "Preparando" },
        { id: "tools", type: "tool-group", round: 1, toolCallIds: ["call"] },
        { id: "final", type: "content", content: "Respuesta final" },
      ],
    };
    const text = JSON.stringify(encodeConversationMessage(message));
    assert.equal(text.split("Respuesta final").length - 1, 1);
    const stored = JSON.parse(text);
    assert.equal(stored.contextContent, undefined);
    assert.equal(stored.imageAttachments, undefined);
    assert.equal(stored.toolCalls, undefined);
    assert.deepEqual(stored.timeline[2], { id: "final", type: "content", contentRef: "message" });
    const decoded = decodeConversationMessage(stored) as StoredConversationMessage;
    assert.deepEqual(decoded.timeline, message.timeline);
    assert.equal(decoded.contextContent ?? decoded.content, message.contextContent);
    assert.equal(message.timeline?.[2].type === "content" && message.timeline[2].content, "Respuesta final");
  });

  test("preserves distinct model context and incremental timeline content", () => {
    const message: StoredConversationMessage = {
      id: "assistant", role: "assistant", content: "Primero y segundo", contextContent: "Resumen para el modelo",
      timeline: [{ id: "first", type: "content", content: "Primero" }, { id: "second", type: "content", content: " y segundo" }],
    };
    assert.deepEqual(decodeConversationMessage(JSON.parse(JSON.stringify(encodeConversationMessage(message)))), message);
  });

  test("accepts legacy expanded events and rejects malformed references", () => {
    const legacy = { id: "assistant", role: "assistant", content: "Done", contextContent: "Done", timeline: [{ id: "final", type: "content", content: "Done" }] };
    assert.deepEqual(decodeConversationMessage(legacy), legacy);
    for (const event of [
      { id: "final", type: "content", contentRef: "unknown" },
      { id: "final", type: "reasoning", contentRef: "message" },
      { id: "final", type: "content", contentRef: "message", content: "conflict" },
    ]) {assert.throws(() => decodeConversationMessage({ content: "Done", timeline: [event] }), /Invalid stored/);}
  });
});

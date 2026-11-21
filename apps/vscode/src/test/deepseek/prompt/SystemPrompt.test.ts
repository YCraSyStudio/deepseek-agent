import * as assert from "node:assert";
import { appendCurrentTimeToUserTurn, createSystemMessage, SYSTEM_PROMPT_AGENT } from "@/contracts/deepseek/Chat";

suite("system tool guidance", () => {

  test("keeps the system message free of the timestamp so the cacheable prefix stays stable", () => {
    const early = createSystemMessage();
    const late = createSystemMessage();

    assert.doesNotMatch(early.content ?? "", /Current local date and time|current_time/);
    assert.strictEqual(early.content, late.content);
    assert.strictEqual(early.content, SYSTEM_PROMPT_AGENT);
  });

  test("carries the current local date and time in the newest user turn", () => {
    const stamped = appendCurrentTimeToUserTurn("Do it", new Date(2026, 7, 6, 12, 34));

    assert.strictEqual(typeof stamped, "string");
    assert.match(stamped as string, /^Do it\n\n<current_time>2026-08-06T12:34[+-]\d{2}:\d{2}(?: \([^)]+\))?<\/current_time>/);
  });

  test("minimizes generated time metadata without modifying the user's own sensitive text", () => {
    const text = "Contact alice@example.test about this code";
    const stamped = appendCurrentTimeToUserTurn(text, new Date("2026-10-21T13:45:00Z"), true) as string;
    assert.ok(stamped.startsWith(text));
    assert.match(stamped, /<current_time>2026-10-21T13:45Z<\/current_time>/);
    assert.doesNotMatch(stamped, /Europe\/|Atlantic\/|America\//);
  });

  test("appends the timestamp to the text part of a message that carries file references", () => {
    const stamped = appendCurrentTimeToUserTurn(
      [
        { type: "text", text: "Describe this" },
        { type: "file", file_id: "file-1" },
      ],
      new Date(2026, 7, 6, 12, 34),
    );

    assert.ok(Array.isArray(stamped));
    const parts = stamped as Array<{ type: string; text?: string; file_id?: string }>;
    assert.strictEqual(parts.length, 2);
    assert.match(parts[0].text ?? "", /^Describe this\n\n<current_time>/);
    assert.strictEqual(parts[1].file_id, "file-1");
  });

  test("still stamps the turn when it carries only attachments", () => {
    const stamped = appendCurrentTimeToUserTurn([{ type: "file", file_id: "file-1" }], new Date(2026, 7, 6, 12, 34));

    const parts = stamped as Array<{ type: string; text?: string }>;
    assert.strictEqual(parts.length, 2);
    assert.strictEqual(parts[0].type, "file");
    assert.match(parts[1].text ?? "", /^<current_time>/);
  });
});

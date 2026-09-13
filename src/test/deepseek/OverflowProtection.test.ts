import * as assert from "assert";
import { readBoundedJson } from "@/infrastructure/deepseek/client/BoundedResponseJson";
import { fitToolResultForModel, estimateToolResultTokens } from "@/application/chat/toolCall/ToolResultFit";
import { boundUtf8HeadTail } from "@/shared/utils/BoundedText";

suite("overflow protection", () => {
  test("keeps terminal JSON and failing diagnostics from the omitted middle", () => {
    const result = fitToolResultForModel(JSON.stringify({
      kind: "command_result", exitCode: 1, durationMs: 100,
      stdout: "success\n".repeat(3000) + "error TS1234: missing type\n" + "success\n".repeat(3000),
      stderr: "", truncated: { stdout: false, stderr: false },
    }), 4096, 500);
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.exitCode, 1);
    assert.strictEqual(parsed.truncated.stdout, true);
    assert.match(parsed.stdout, /error TS1234: missing type/);
    assert.ok(estimateToolResultTokens(result) <= 500);
  });

  test("accounts for escaped text and bounds every result without a cumulative cycle limit", () => {
    let total = 0;
    for (let index = 0; index < 8; index++) {
      const result = fitToolResultForModel("\u0001".repeat(100_000));
      const tokens = estimateToolResultTokens(result);
      assert.ok(tokens <= 16_000);
      total += tokens;
    }
    assert.ok(total > 64_000);
  });

  test("omits oversized terminal metadata without losing its failure status", () => {
    const result = fitToolResultForModel(JSON.stringify({
      kind: "command_result", command: "x".repeat(200_000),
      stdout: "", stderr: "failed", exitCode: 2, timedOut: false,
    }), 1024, 300);
    assert.strictEqual(JSON.parse(result).exitCode, 2);
    assert.strictEqual(JSON.parse(result).metadataOmitted, true);
    assert.ok(estimateToolResultTokens(result) <= 300);
  });
  test("never throws when terminal metadata alone overflows the budget", () => {
    const bounded = fitToolResultForModel(JSON.stringify({
      kind: "command_result",
      command: "x".repeat(200_000),
      signal: "SIGTERM".repeat(20_000),
      stdout: "ok",
      stderr: "",
      exitCode: null,
    }), 1024, 300);

    assert.ok(bounded.length > 0);
    assert.ok(Buffer.byteLength(bounded, "utf8") <= 1024);
    assert.ok(estimateToolResultTokens(bounded) <= 300);
  });

  test("bounds tool results by UTF-8 bytes while preserving head and tail", () => {
    const value = `HEAD-${"界".repeat(100)}-TAIL`;
    const bounded = fitToolResultForModel(value, 96);

    assert.ok(Buffer.byteLength(bounded, "utf8") <= 96);
    assert.ok(bounded.startsWith("HEAD-"));
    assert.ok(bounded.endsWith("-TAIL"));
    assert.match(bounded, /middle omitted/);
  });

  test("bounds generic continuity text by UTF-8 bytes", () => {
    const bounded = boundUtf8HeadTail(`start-${"😀".repeat(100)}-end`, 96);

    assert.strictEqual(bounded.truncated, true);
    assert.ok(Buffer.byteLength(bounded.text, "utf8") <= 96);
    assert.ok(bounded.text.startsWith("start-"));
    assert.ok(bounded.text.endsWith("-end"));
    assert.ok(!bounded.text.includes("�"));
    assert.strictEqual(hasUnpairedSurrogate(bounded.text), false);
  });

  test("honors byte limits smaller than the omission marker", () => {
    const bounded = boundUtf8HeadTail("😀😀😀", 5);

    assert.ok(Buffer.byteLength(bounded.text, "utf8") <= 5);
    assert.strictEqual(hasUnpairedSurrogate(bounded.text), false);
  });

  test("rejects declared and streamed JSON bodies above their limits", async () => {
    await assert.rejects(
      readBoundedJson(new Response("{}", { headers: { "content-length": "100" } }), 16),
      /exceeded 16 bytes/,
    );

    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"value":"'));
        controller.enqueue(encoder.encode(`${"x".repeat(64)}"}`));
        controller.close();
      },
    }));
    await assert.rejects(readBoundedJson(response, 32), /exceeded 32 bytes/);
  });

  test("parses a response that stays inside the byte budget", async () => {
    assert.deepStrictEqual(await readBoundedJson(new Response('{"ok":true}'), 32), { ok: true });
  });
});

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) {return true;}
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) {return true;}
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

import * as assert from "node:assert";
import { BoundedOutput } from "@/infrastructure/tools/builtins/terminal/ShellExecution";

suite("bounded terminal diagnostic capture", () => {
  test("preserves middle diagnostics across chunks and streams of ordinary output", () => {
    const output = new BoundedOutput(4096);
    output.append(Buffer.from("HEAD\n" + "ordinary output\n".repeat(1000)));
    for (const byte of Buffer.from("\u001b[31merror TS1234: tipo inválido 界\u001b[0m\r\n    at compile (app.ts:7)\n")) {
      output.append(Buffer.from([byte]));
    }
    output.append(Buffer.from("ordinary output\n".repeat(1000) + "TAIL"));
    const text = output.toString();
    assert.strictEqual(output.truncated, true);
    assert.ok(text.startsWith("HEAD"));
    assert.ok(text.endsWith("TAIL"));
    assert.match(text, /error TS1234: tipo inválido 界/);
    assert.match(text, /at compile \(app.ts:7\)/);
    assert.ok(Buffer.byteLength(text) <= 4096);
    assert.strictEqual(output.toString(), text);
  });

  test("returns short output unchanged and includes an unterminated final diagnostic", () => {
    const output = new BoundedOutput(4096);
    const short = "warning: first\r\nerror: second 界";
    output.append(Buffer.from(short));
    assert.strictEqual(output.toString(), short);
    assert.strictEqual(output.truncated, false);
    output.append(Buffer.from("\n" + "normal\n".repeat(2000) + "fatal: final error"));
    assert.match(output.toString(), /fatal: final error/);
  });

  test("bounds error floods and very long lines while retaining later diagnostics", () => {
    const output = new BoundedOutput(4096);
    output.append(Buffer.from("error first\n" + "error flood\n".repeat(10000)));
    output.append(Buffer.from("x".repeat(1000000) + "\nerror final\n"));
    const text = output.toString();
    assert.ok(Buffer.byteLength(text) <= 4096);
    assert.match(text, /error first/);
    assert.match(text, /error final/);
    assert.match(text, /bounded/);
  });
});

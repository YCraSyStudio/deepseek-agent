import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createMemoryGuard } from "./test-memory-guard.mjs";

test("assert guard preserves comparisons and bounds DOM failure diagnostics under a heap cap", () => {
  const child = spawnSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import loose from "node:assert";
    import { JSDOM } from "jsdom";
    import { installAssertMemoryGuard } from "./scripts/assert-memory-guard.mjs";
    const check = assert.ok.bind(assert);
    const throws = assert.throws.bind(assert);
    installAssertMemoryGuard();
    installAssertMemoryGuard();
    const shared = { value: 1 }; shared.self = shared;
    assert.equal(shared, shared);
    assert.deepStrictEqual(shared, { value: 1, self: shared });
    assert.notStrictEqual({ a: 1 }, { a: 1 });
    loose.equal("1", 1);
    throws(() => assert.strictEqual({ a: 1 }, { a: 1 }), { code: "ERR_ASSERTION" });
    const late = Array(300).fill(0); const different = [...late]; different[299] = 1;
    throws(() => assert.deepStrictEqual(late, different), { code: "ERR_ASSERTION" });
    const deep = { a: { b: { c: 1 } } };
    throws(() => assert.deepStrictEqual(deep, { a: { b: { c: 2 } } }), { code: "ERR_ASSERTION" });
    let left = { value: 1 }; let right = { value: 2 };
    for (let depth = 0; depth < 12; depth++) { left = { child: left }; right = { child: right }; }
    throws(() => assert.deepStrictEqual(left, right), { code: "ERR_ASSERTION" });
    const opaque = Object.defineProperty({}, "window", { get() { throw new Error("must not inspect getters"); } });
    assert.strictEqual(opaque, opaque);
    throws(() => assert.strictEqual(opaque, null), { code: "ERR_ASSERTION" });
    const supplied = new Error("custom");
    throws(() => assert.equal(1, 2, supplied), error => error === supplied);
    const dom = new JSDOM("<div><span>visible</span></div>");
    const element = dom.window.document.querySelector("div");
    assert.strictEqual(element, element);
    assert.notStrictEqual(element, dom.window.document.querySelector("span"));
    throws(() => assert.strictEqual(element, null), error => {
      check(error.code === "ERR_ASSERTION");
      check(error.message.length < 2000);
      check(typeof error.actual === "string");
      return true;
    });
    throws(() => loose.strictEqual(dom.window, null), { code: "ERR_ASSERTION" });
    dom.window.close();
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 15000, maxBuffer: 32768 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || String(child.error || child.signal));
});

test("RSS watchdog stops once and reports the failing test", () => {
  const snapshot = rssMb => ({ rssMb, heapUsedMb: 1, heapTotalMb: 2, externalMb: 0, arrayBuffersMb: 0 });
  let rss = 10; let stops = 0; const failures = [];
  const guard = createMemoryGuard({ limitMb: 20, sample: () => snapshot(rss),
    currentLabel: () => "failing test", log: () => {}, onExceeded: value => failures.push(value),
    setIntervalFn: () => 42, clearIntervalFn: () => { stops++; } });
  guard.start(); guard.start(); guard.check();
  assert.equal(guard.breached, false);
  rss = 25; guard.check(); guard.check(); guard.stop();
  assert.equal(stops, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, "failing test");
  assert.equal(guard.peak.rssMb, 25);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { mock } from "node:test";
import { HeadlessBrowserSession } from "@/infrastructure/capture/HeadlessBrowserSession";

const worker = `
const fs = require('node:fs');
let buffer = '';
fs.createReadStream(null, {fd:3}).on('data', chunk => {
 buffer += chunk.toString(); let end;
 while ((end = buffer.indexOf('\\0')) !== -1) {
  const m = JSON.parse(buffer.slice(0,end)); buffer = buffer.slice(end+1);
  if (m.method === 'Test.block') continue;
  if (m.method === 'Test.crash') {process.exit(9);}
  if (m.method === 'Test.invalid') {fs.writeSync(4,'invalid-json\\0');continue;}
  if (m.method === 'Test.error') {fs.writeSync(4,JSON.stringify({id:m.id,error:{message:'Unsupported method'}})+'\\0');continue;}
  if (m.method === 'Test.empty') {fs.writeSync(4,JSON.stringify({id:m.id})+'\\0');continue;}
  if (m.method === 'Test.event') {
    for(const event of [{sessionId:m.sessionId,method:'Unobserved'}, {sessionId:m.sessionId,method:'Changed'}, {sessionId:m.sessionId,method:'Changed',params:{value:'updated'}}])fs.writeSync(4,JSON.stringify(event)+'\\0');
    fs.writeSync(4,JSON.stringify({id:999999,result:{ignored:true}})+'\\0');
  }
  let result = {};
  if (m.method === 'Browser.getVersion') result = {product:'Chrome/156'};
  if (m.method === 'Target.createTarget') result = {targetId:'owned-target'};
  if (m.method === 'Target.attachToTarget') result = {sessionId:'owned-page'};
  if (m.method === 'Test.echo') result = {value:m.params.value, sessionId:m.sessionId};
  fs.writeSync(4, JSON.stringify({id:m.id,result})+'\\0');
 }
});`;

function session(signal = new AbortController().signal, script = worker) {
  const child = spawn(process.execPath, ["-e", script], {
    detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  });
  return { child, browser: new HeadlessBrowserSession(child, signal) };
}

suite("Owned headless browser", () => {
  test("expires an unanswered request without closing an otherwise usable session", async () => {
    const { browser } = session();
    try {
      const page = await browser.page(); mock.timers.enable({ apis: ["setTimeout"] });
      const pending = page.request("Test.block"); mock.timers.tick(10000);
      await assert.rejects(pending, /Headless CDP Test.block timed out/);
      mock.timers.reset();
      assert.deepEqual(await page.request("Test.echo", { value: "after timeout" }), { value: "after timeout", sessionId: "owned-page" });
    } finally { mock.timers.reset(); await browser.dispose(); }
  });
  for (const terminated of [false, true]) {
    test(`rejects oversized CDP input and terminates the owned child, terminated packet=${terminated}`, async () => {
      const { child, browser } = session();
      try {
        const page = await browser.page(); const pending = page.request("Test.block");
        const bytes = Buffer.alloc(24 * 1024 * 1024 + 2, 120);
        if (terminated) { bytes[bytes.length - 1] = 0; }
        (child.stdio[4] as Readable).emit("data", bytes);
        await assert.rejects(pending, /CDP response exceeds its size limit/);
        await browser.dispose(); assert.ok(child.exitCode !== null || child.signalCode !== null);
      } finally { await browser.dispose(); }
    });
  }
  test("rejects pending requests after an output pipe failure", async () => {
    const { child, browser } = session();
    try {
      const page = await browser.page(); const pending = page.request("Test.block");
      (child.stdio[4] as Readable).emit("error", new Error("Output pipe unavailable"));
      await assert.rejects(pending, /Output pipe unavailable/);
      await assert.rejects(page.request("Test.echo"), /Output pipe unavailable/);
    } finally { await browser.dispose(); }
  });
  test("retains bounded diagnostic context if the browser closes its output", async () => {
    const { child, browser } = session();
    try {
      const page = await browser.page(); const pending = page.request("Test.block");
      child.stderr!.emit("data", Buffer.from("x".repeat(9000) + " diagnostic tail"));
      child.stderr!.emit("error", new Error("Diagnostic channel unavailable"));
      (child.stdio[4] as Readable).emit("end");
      await assert.rejects(pending, error => error instanceof Error && /pipe closed.*diagnostic tail/.test(error.message) && error.message.length < 600);
    } finally { await browser.dispose(); }
  });
  test("rejects a failed write without leaving its request pending", async () => {
    const { child, browser } = session();
    try {
      const page = await browser.page(); (child.stdio[3] as Writable).end();
      await assert.rejects(page.request("Test.echo"), /write after end|pipe closed|exited/);
    } finally { await browser.dispose(); }
  });
  test("scopes event subscriptions, delivers absent params as an empty object and removes listeners", async () => {
    const { child, browser } = session();
    try {
      const page = await browser.page(); const first: unknown[] = []; const second: unknown[] = [];
      const removeFirst = page.on!("Changed", value => { first.push(value); });
      const removeSecond = page.on!("Changed", value => { second.push(value); });
      await page.request("Test.event"); assert.deepEqual(first, [{}, { value: "updated" }]); assert.deepEqual(second, first);
      removeFirst(); await page.request("Test.event"); assert.equal(first.length, 2); assert.equal(second.length, 4);
      removeSecond(); await page.request("Test.event"); assert.equal(second.length, 4);
      page.close!(); await browser.dispose(); assert.ok(child.exitCode !== null || child.signalCode !== null);
    } finally { await browser.dispose(); }
  });
  test("keeps a CDP request error local and accepts a response with no result", async () => {
    const { browser } = session();
    try {
      const page = await browser.page();
      await assert.rejects(page.request("Test.error"), /Headless CDP request failed: Unsupported method/);
      assert.deepEqual(await page.request("Test.empty"), {});
      assert.deepEqual(await page.request("Test.echo", { value: "still usable" }), { value: "still usable", sessionId: "owned-page" });
    } finally { await browser.dispose(); }
  });
  test("rejects malformed JSON and all subsequent requests with the original failure", async () => {
    const { browser } = session();
    try {
      const page = await browser.page();
      await assert.rejects(page.request("Test.invalid"), /Invalid headless CDP response/);
      await assert.rejects(page.request("Test.echo"), /Invalid headless CDP response/);
    } finally { await browser.dispose(); }
  });
  for (const [replacement, expected] of [
    ["{product:42}", /supported Chromium build/],
    ["{product:'Firefox\/156'}", /supported Chromium build/],
    ["{targetId:42}", /did not create a page/],
    ["{sessionId:42}", /did not attach to its page/],
  ] as const) {
    test(`rejects an unsupported page handshake: ${replacement}`, async () => {
      const original = replacement.startsWith("{product") ? "{product:'Chrome/156'}" : replacement.startsWith("{targetId") ? "{targetId:'owned-target'}" : "{sessionId:'owned-page'}";
      const { browser } = session(undefined, worker.replace(original, replacement));
      try { await assert.rejects(browser.page(), expected); } finally { await browser.dispose(); }
    });
  }
  test("handles cancellation that precedes session construction", async () => {
    const controller = new AbortController(); controller.abort("cancelled before session");
    const { child, browser } = session(controller.signal);
    try { await assert.rejects(browser.page(), error => error === controller.signal.reason); }
    finally { await browser.dispose(); }
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  });
  test("routes page requests through private pipes and terminates its process on disposal", async () => {
    const { child, browser } = session();
    try {
      const page = await browser.page();
      assert.deepEqual(await page.request("Test.echo", { value: "中文 y español" }), { value: "中文 y español", sessionId: "owned-page" });
    } finally {await browser.dispose();}
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    await browser.dispose();
  });

  test("cancels an unanswered request and waits for process cleanup", async () => {
    const controller = new AbortController();
    const { child, browser } = session(controller.signal);
    try {
      const page = await browser.page();
      const blocked = page.request("Test.block");
      controller.abort(new Error("Capture cancelled"));
      await assert.rejects(blocked, /cancelled/);
    } finally {await browser.dispose();}
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  });

  test("rejects pending requests if the browser crashes", async () => {
    const { child, browser } = session();
    try {
      const page = await browser.page();
      await assert.rejects(page.request("Test.crash"), /exited|pipe closed/);
    } finally {await browser.dispose();}
    assert.equal(child.exitCode, 9);
  });
});

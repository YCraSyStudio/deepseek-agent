import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  let result = {};
  if (m.method === 'Browser.getVersion') result = {product:'Chrome/156'};
  if (m.method === 'Target.createTarget') result = {targetId:'owned-target'};
  if (m.method === 'Target.attachToTarget') result = {sessionId:'owned-page'};
  if (m.method === 'Test.echo') result = {value:m.params.value, sessionId:m.sessionId};
  fs.writeSync(4, JSON.stringify({id:m.id,result})+'\\0');
 }
});`;

function session(signal = new AbortController().signal) {
  const child = spawn(process.execPath, ["-e", worker], {
    detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  });
  return { child, browser: new HeadlessBrowserSession(child, signal) };
}

suite("Owned headless browser", () => {
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

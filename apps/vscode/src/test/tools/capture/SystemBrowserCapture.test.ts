import { nodeExecutableFixture } from "../../support/NodeExecutableFixture";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SystemBrowserCapture } from "@/infrastructure/capture/SystemBrowserCapture";

suite("system browser capture lifecycle", () => {
  let root: string;
  let restoreLauncher: () => void;
  setup(async () => { root = await mkdtemp(path.join(tmpdir(), "system-browser-test-")); restoreLauncher = nodeExecutableFixture(path.join(root, "browser")); });
  teardown(async () => { restoreLauncher(); await rm(root, { recursive: true, force: true }); });

  async function binary(mode: "success" | "navigation-error" | "oversize") {
    const log = path.join(root, "requests.jsonl"); const executable = path.join(root, "browser");
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const log = ${JSON.stringify(log)};
fs.appendFileSync(log, JSON.stringify({argv:process.argv,pid:process.pid})+'\\n');
let buffer = ''; let width = 0; let height = 0;
fs.createReadStream(null, {fd:3}).on('data', chunk => {
 buffer += chunk.toString(); let end;
 while ((end = buffer.indexOf('\\0')) !== -1) {
  const m = JSON.parse(buffer.slice(0,end)); buffer = buffer.slice(end+1);
  fs.appendFileSync(log, JSON.stringify(m)+'\\n');
  let result = {};
  if (m.method === 'Browser.getVersion') result = {product:'Chrome/156'};
  if (m.method === 'Target.createTarget') result = {targetId:'owned'};
  if (m.method === 'Target.attachToTarget') result = {sessionId:'page'};
  if (m.method === 'Page.navigate' && ${JSON.stringify(mode)} === 'navigation-error') result = {errorText:'ERR_NAME_NOT_RESOLVED'};
  if (m.method === 'Emulation.setDeviceMetricsOverride') {width=m.params.width;height=m.params.height;}
  if (m.method === 'Runtime.evaluate' && m.params.returnByValue) result = {result:{value:{width,height,scale:1}}};
  if (m.method === 'Page.getLayoutMetrics') result = {cssLayoutViewport:{clientWidth:width,clientHeight:height}};
  if (m.method === 'Page.captureScreenshot') result = {data:Buffer.alloc(${mode === "oversize" ? "16*1024*1024+1" : "4"},1).toString('base64')};
  fs.writeSync(4, JSON.stringify({id:m.id,result})+'\\0');
 }
});
`);
    await chmod(executable, 0o700);
    return { executable, log };
  }
  for (const mode of ["success", "navigation-error", "oversize"] as const) {
    test(`captures through owned browser pipes and removes its temporary profile after ${mode}`, async function () {
      this.timeout(10000);
      const fixture = await binary(mode);
      const capture = new SystemBrowserCapture({ executable: async () => fixture.executable });
      const operation = capture.capture({ target: "web", url: "https://example.test/page", width: 800, height: 600 }, new AbortController().signal);
      if (mode === "success") {
        const frame = await operation;
        assert.equal(frame.target, "https://example.test/page"); assert.deepEqual(frame.bytes, Buffer.alloc(4, 1));
      } else {
        await assert.rejects(operation, mode === "navigation-error" ? /ERR_NAME_NOT_RESOLVED/ : /screenshot exceeds the size limit/);
      }
      const log = (await readFile(fixture.log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      const profile = (log[0].argv as string[]).find(argument => argument.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
      await assert.rejects(stat(path.dirname(profile)), { code: "ENOENT" });
      assert.equal(log.some(entry => entry.method === "Page.navigate" && entry.params.url === "https://example.test/page"), true);
      assert.throws(() => process.kill(log[0].pid, 0), { code: "ESRCH" });
    });
  }
  test("cancellation before capture avoids browser resolution and launch", async () => {
    let resolved = false;
    const capture = new SystemBrowserCapture({ executable: async () => { resolved = true; return "unused"; } });
    const controller = new AbortController(); controller.abort(new Error("capture cancelled"));
    await assert.rejects(capture.capture({ target: "web", url: "https://example.test" }, controller.signal), /capture cancelled/);
    assert.equal(resolved, false);
  });
});

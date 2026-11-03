import { nodeExecutableFixture } from "../../support/NodeExecutableFixture";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import { WebAccessPolicy } from "@/infrastructure/browser/NetworkPolicy";

suite("headless web document lifecycle", () => {
  let root: string;
  let restoreLauncher: () => void;
  setup(async () => { root = await mkdtemp(path.join(tmpdir(), "web-runtime-")); restoreLauncher = nodeExecutableFixture(path.join(root, "browser")); });
  teardown(async () => { restoreLauncher(); await rm(root, { recursive: true, force: true }); });
  async function fixture(mode: string) {
    const executable = path.join(root, "browser"); const log = path.join(root, "requests.jsonl");
    await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs');const log=${JSON.stringify(log)};const mode=${JSON.stringify(mode)};
fs.appendFileSync(log,JSON.stringify({argv:process.argv,pid:process.pid})+'\\n');
const send=value=>fs.writeSync(4,JSON.stringify(value)+'\\0');let buffer='';
fs.createReadStream(null,{fd:3}).on('data',chunk=>{buffer+=chunk;let end;
while((end=buffer.indexOf('\\0'))!==-1){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);fs.appendFileSync(log,JSON.stringify(m)+'\\n');let result={};
if(m.method==='Browser.getVersion')result={product:'Chrome/156'};
if(m.method==='Target.createTarget')result={targetId:'owned'};
if(m.method==='Target.attachToTarget')result={sessionId:'page'};
if(m.method==='Fetch.enable')for(const [requestId,request]of [['get',{url:'https://example.com/page',method:'GET'}],['post',{url:'https://example.com/page',method:'POST'}],['private',{url:'https://127.0.0.1/',method:'GET'}],['missing',undefined]])send({sessionId:'page',method:'Fetch.requestPaused',params:{requestId,request}});
if(m.method==='Page.navigate'&&mode==='navigation-error')result={errorText:'ERR_NAME_NOT_RESOLVED'};
if(m.method==='Runtime.evaluate'){
if(mode==='abort')continue;
result=mode==='exception'?{exceptionDetails:{text:'extraction failed'}}:mode==='missing'?{}:{result:{value:{title:'Fixture page',url:mode==='redirect'?'https://unapproved.example.net/':'https://example.com/page',content:mode==='empty'?'':'  Useful document text.  '}}};}
send({id:m.id,result});}});
`);
    await chmod(executable, 0o700); return { executable, log };
  }
  for (const mode of ["success", "navigation-error", "exception", "missing", "redirect", "empty", "abort"]) {
    test(`validates document access and cleans up browser resources after ${mode}`, async function () {
      this.timeout(10000);
      const browser = await fixture(mode); const policy = new WebAccessPolicy(); policy.grantResult("https://example.com/page");
      const runtime = new HeadlessWebRuntime({ executable: async () => browser.executable });
      const controller = new AbortController();
      const operation = runtime.render("https://example.com/page", policy, controller.signal);
      const settled = operation.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      if (mode === "abort") {
        let ready = false;
        for (let i = 0; i < 200 && !ready; i++) {
          ready = (await readFile(browser.log, "utf8").catch(() => "")).includes('"method":"Runtime.evaluate"');
          if (!ready) { await new Promise(resolve => setTimeout(resolve, 5)); }
        }
        assert.equal(ready, true, "Browser must reach document extraction before cancellation");
        controller.abort(new Error("read cancelled"));
      }
      const outcome = await settled;
      if (mode === "success") {
        assert.ifError(outcome.error); assert.equal(outcome.value?.content, "Useful document text.");
        assert.equal(outcome.value?.title, "Fixture page"); assert.equal(outcome.value?.url, "https://example.com/page");
      } else {
        const errors: Record<string, RegExp> = { "navigation-error": /ERR_NAME_NOT_RESOLVED/, exception: /loading deadline/, missing: /loading deadline/, redirect: /not authorized/, empty: /readable text content/, abort: /read cancelled/ };
        assert.match(String(outcome.error), errors[mode]);
      }
      assert.deepEqual(runtime.getDiagnostics(), { source: "local-chromium", available: true, active: 0, completed: mode === "success" ? 1 : 0, failed: mode === "success" ? 0 : 1 });
      const requests = (await readFile(browser.log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      const decisions = requests.filter(entry => entry.method === "Fetch.continueRequest" || entry.method === "Fetch.failRequest");
      assert.deepEqual(decisions.map(entry => [entry.params.requestId, entry.method]), [["get", "Fetch.continueRequest"], ["post", "Fetch.failRequest"], ["private", "Fetch.failRequest"], ["missing", "Fetch.failRequest"]]);
      const profile = requests[0].argv.find((argument: string) => argument.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
      await assert.rejects(stat(path.dirname(profile)), { code: "ENOENT" });
      assert.throws(() => process.kill(requests[0].pid, 0), { code: "ESRCH" });
      await runtime.dispose(); assert.equal(runtime.getDiagnostics().available, false);
    });
  }
});

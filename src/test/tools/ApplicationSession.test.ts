import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ApplicationSessionResult } from "@/contracts/ApplicationSession";
import type { ChatCompletionResponse, ToolCall, ToolDefinition } from "@/contracts";
import { applicationSessionTool } from "@/infrastructure/tools/builtins/terminal/ApplicationSession";
import { ManagedApplicationSessions, closeConversationApplications, shutdownApplicationSessions } from "@/infrastructure/tools/builtins/terminal/ManagedApplicationSessions";
import { setToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import { ToolExecutor } from "@/application/tools/ToolExecutor";
import { runToolCallCycle } from "@/application/chat/toolCall/ToolCallCycle";
import { executeToolCall } from "@/vscode/webviews/handlers/chat/toolCalls/ToolExecution";
import { createExecutionContext, toolCall } from "../chat/executionHarness";

function quote(value: string): string {return process.platform === "win32" ? `"${value}"` : `'${value.replace(/'/g, "'\\''")}'`;}

suite("managed application sessions", () => {
  let directory: string;
  let command: string;
  const alive = (pid: number) => {try {process.kill(pid, 0); return true;} catch {return false;}};
  setup(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "deepseek-app-session-"));
    const fixture = path.join(directory, "preview.cjs");
    await writeFile(fixture, `
const mode = process.argv[2];
if (mode === 'fail') { console.error('startup failed'); process.exit(7); }
if (mode === 'stdin') {process.stdin.resume();process.stdin.on('end',()=>process.exit(0));}
if (mode === 'tree' || mode === 'wrapper') {
 const child = require('node:child_process').spawn(process.execPath,[__filename],{stdio:['ignore','inherit','inherit']});
 console.log('CHILD:'+child.pid);
 if(mode === 'wrapper')setTimeout(()=>process.exit(0),400);
} else {
 const server = require('node:http').createServer((_req,res)=>res.end('preview alive'));
 server.listen(0,'127.0.0.1',()=>console.log('PORT:'+server.address().port));
}
if(mode === 'flood') {process.stdout.write('x'.repeat(150000)); process.stderr.write('y'.repeat(150000));}
setInterval(()=>{},1000);
`);
    command = `${quote(process.execPath)} ${quote(fixture)}`;
    setToolWorkspaceHost({
      getRootPath: () => directory, getCommandShell: () => "VS Code integrated terminal (default profile)",
      realPath: realpath, readFile: async () => new Uint8Array(), writeFile: async () => undefined,
      stat: async () => ({ type: "file", size: 0 }), createParentDirectory: async () => undefined, readDirectory: async () => [],
    });
  });
  teardown(async () => {await shutdownApplicationSessions(); await rm(directory, { recursive: true, force: true });});

  test("sequential launch, capture and stop calls run while the real preview remains alive", async function () {
    this.timeout(10_000);
    const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-1");
    const captureDefinition: ToolDefinition = { type: "function", function: { name: "capture_screenshot", parameters: { type: "object", properties: {} } } };
    let round = 0; let session: ApplicationSessionResult | undefined; let captured = false;
    const response = (calls: ToolCall[] = []): ChatCompletionResponse => ({
      id: `qa-${round}`, object: "chat.completion", created: 0, model: "qa",
      choices: [{ index: 0, finish_reason: calls.length ? "tool_calls" : "stop", message: { role: "assistant", content: calls.length ? null : "done", ...(calls.length ? { tool_calls: calls } : {}) } }],
    });
    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "start and capture the preview" }],
      tools: [applicationSessionTool.definition, captureDefinition], model: "qa",
      modelClient: {
        completeRound: async () => {
          round++;
          if (round === 1) {return response([toolCall("application_session", { action: "start", command, wait_ms: 250 })]);}
          if (round === 2) {return response([toolCall("capture_screenshot")]);}
          if (round === 3 || round === 4) {return response([{ ...toolCall("application_session", { action: "status", session_id: session!.sessionId }), id: `status-${round}` }]);}
          if (round === 5) {return response([{ ...toolCall("application_session", { action: "stop", session_id: session!.sessionId }), id: "stop" }]);}
          return response();
        },
        streamRound: async () => assert.fail("unexpected streaming"),
      },
      executeToolCall: async (call) => {
        if (call.function.name === "capture_screenshot") {
          assert.equal(session?.status, "running"); assert.ok(alive(session!.pid!));
          const port = /PORT:(\d+)/.exec(session!.stdout)?.[1]; assert.ok(port, session!.stdout);
          assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "preview alive");
          captured = true; return "captured while application was open";
        }
        const raw = await applicationSessionTool.forcedHandler!(JSON.parse(call.function.arguments), { applicationSession: (request) => sessions.execute(request) });
        const value = JSON.parse(raw) as ApplicationSessionResult;
        if (value.status === "running") {session = value;}
        else {assert.ok(captured); assert.equal(value.status, "stopped");}
        return raw;
      },
    });
    assert.equal(result.toolCallsExecuted, 5); assert.equal(captured, true);
    assert.equal(alive(session!.pid!), false);
  });

  test("start is reviewed with the exact executable shell before anything launches", async () => {
    const registry = new ToolRegistry(); registry.register(applicationSessionTool);
    const harness = createExecutionContext({ executor: new ToolExecutor(registry), permissionMode: "auto-approve", review: () => ({ decision: "approve", risk: "routine", confidence: "high", reason: "requested preview" }) });
    const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-review");
    let launches = 0;
    harness.context.applicationSession = async (request) => {launches++; assert.equal(harness.reviews(), 1); return sessions.execute(request);};
    const pending = JSON.parse(await applicationSessionTool.handler({ action: "start", command }, { applicationSession: harness.context.applicationSession }));
    assert.equal(launches, 0); assert.equal(pending.command, command); assert.equal(pending.cwd, directory);
    assert.notEqual(pending.shell, "VS Code integrated terminal (default profile)");
    const result = JSON.parse(await executeToolCall(toolCall("application_session", { action: "start", command, wait_ms: 250 }), harness.context));
    assert.equal(result.status, "running"); assert.equal(launches, 1); assert.equal(harness.confirmations(), 0);
  });

  test("early startup failures are returned as errors instead of successful launches", async () => {
    const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-failure");
    const result = await applicationSessionTool.forcedHandler!({ action: "start", command: `${command} fail`, wait_ms: 250 }, { applicationSession: (request) => sessions.execute(request) });
    assert.match(result, /^Error: application launch ended/); assert.match(result, /startup failed/); assert.match(result, /"exitCode":7/);
  });

  test("keeps stdin open for preview hosts that shut down when their owner disconnects", async () => {
    const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-stdin");
    const started = await sessions.execute({ action: "start", command: `${command} stdin`, wait_ms: 200 });
    assert.equal(started.status, "running"); assert.ok(alive(started.pid!));
    const stopped = await sessions.execute({ action: "stop", session_id: started.sessionId });
    assert.equal(stopped.status, "stopped"); assert.equal(alive(started.pid!), false);
  });

  test("cancel, turn disposal, chat deletion and extension shutdown stop only their owned sessions", async function () {
    this.timeout(10_000);
    const abort = new AbortController();
    const first = new ManagedApplicationSessions(abort.signal, "chat-first");
    const second = new ManagedApplicationSessions(new AbortController().signal, "chat-other");
    const a = await first.execute({ action: "start", command, wait_ms: 150 });
    const b = await second.execute({ action: "start", command, wait_ms: 150 });
    await assert.rejects(first.execute({ action: "stop", session_id: b.sessionId }), /another chat/);
    abort.abort(); await first.dispose(); assert.equal(alive(a.pid!), false); assert.ok(alive(b.pid!));
    await closeConversationApplications("chat-other"); assert.equal(alive(b.pid!), false);
    const third = new ManagedApplicationSessions(new AbortController().signal, "chat-third");
    const c = await third.execute({ action: "start", command, wait_ms: 150 });
    await third.dispose(); assert.equal(alive(c.pid!), false);
    const fourth = new ManagedApplicationSessions(new AbortController().signal, "chat-fourth");
    const d = await fourth.execute({ action: "start", command, wait_ms: 150 });
    await shutdownApplicationSessions(); assert.equal(alive(d.pid!), false);
  });

  test("enforces a lifetime and retains bounded application output", async function () {
    this.timeout(5000);
    const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-lifetime", 500);
    const started = await sessions.execute({ action: "start", command: `${command} flood`, wait_ms: 150 });
    assert.equal(started.status, "running");
    assert.ok(Buffer.byteLength(started.stdout) <= 65536); assert.ok(Buffer.byteLength(started.stderr) <= 65536);
    assert.equal(started.truncated.stdout, true); assert.equal(started.truncated.stderr, true);
    const ended = await sessions.execute({ action: "status", session_id: started.sessionId, wait_ms: 1000 });
    assert.equal(ended.timedOut, true); assert.equal(ended.status, "stopped"); assert.equal(alive(started.pid!), false);
  });

  for (const mode of ["tree", "wrapper"]) {
    test(`cleans descendants when the ${mode === "tree" ? "session is stopped" : "launch wrapper exits"}`, async function () {
      if (process.platform !== "linux") {this.skip();}
      this.timeout(5000);
      const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-tree");
      const started = await sessions.execute({ action: "start", command: `${command} ${mode}`, wait_ms: 200 });
      const childPid = Number(/CHILD:(\d+)/.exec(started.stdout)?.[1]); assert.ok(childPid, started.stdout);
      if (mode === "wrapper") {await sessions.execute({ action: "status", session_id: started.sessionId, wait_ms: 1000 });}
      else {await sessions.execute({ action: "stop", session_id: started.sessionId });}
      // A reparented zombie is already terminated; init may not have reaped it yet.
      let running = false;
      try {const state = await readFile(`/proc/${childPid}/stat`, "utf8"); running = !/^\d+ \(.*\) Z /.test(state);}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;}}
      assert.equal(running, false, "owned child must not keep running after its launch session ends");
    });
  }

  test("bounds concurrently running previews", async () => {
    const sessions = new ManagedApplicationSessions(new AbortController().signal, "chat-limit");
    for (let index = 0; index < 3; index++) {await sessions.execute({ action: "start", command, wait_ms: 25 });}
    await assert.rejects(sessions.execute({ action: "start", command }), /3 running/);
  });

  test("rejects invalid requests, manual detachment and arbitrary PID control", async () => {
    const context = { applicationSession: async () => assert.fail("must not execute") };
    for (const args of [{ action: "start" }, { action: "status", session_id: "1234" }, { action: "stop", session_id: "a".repeat(36) }, { action: "start", command, wait_ms: 30000 }, { action: "status", command, session_id: "a0b1c2d3-0000-0000-0000-123456789abc" }]) {
      await assert.rejects(applicationSessionTool.forcedHandler!(args, context));
    }
    assert.match(await applicationSessionTool.forcedHandler!({ action: "start", command: "nohup app &" }, context), /background process launch rejected/);
  });
});

import assert from "node:assert/strict";
import { deactivate } from "@/extension/lifecycle/Deactivate";
import { setActiveProvider, shutdownActiveProvider } from "@/extension/lifecycle/ExtensionRuntime";
import type { WebviewProvider } from "@/vscode/webviews/WebviewProvider";
import { ManagedApplicationSessions } from "@/infrastructure/tools/builtins/terminal/ManagedApplicationSessions";
import { startKeepAliveTerminal, listKeepAliveTasks, getKeepAliveTerminal } from "@/infrastructure/tools/builtins/terminal/KeepAliveTerminals";
import { executeShellCommand, resolveCommandEnvironment } from "@/infrastructure/tools/builtins/terminal/ShellExecution";
import { setToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";

suite("extension deactivation resource lifecycle", () => {
  teardown(async () => { setActiveProvider(undefined); await deactivate(); });
  test("shuts down each provider only once and permits a replacement during shutdown", async () => {
    const calls: string[] = [];
    const replacement = { shutdown: async () => { calls.push("replacement"); } } as unknown as WebviewProvider;
    setActiveProvider({ shutdown: async () => { calls.push("first"); setActiveProvider(replacement); } } as unknown as WebviewProvider);
    await shutdownActiveProvider(); assert.deepEqual(calls, ["first"]);
    await shutdownActiveProvider(); await shutdownActiveProvider();
    assert.deepEqual(calls, ["first", "replacement"]);
  });
  for (const failed of [false, true]) {
    test(`terminates owned applications, persistent terminals and commands when provider failure=${failed}`, async function () {
      this.timeout(10000);
      const unused = async (): Promise<never> => { throw new Error("Unexpected workspace IO"); };
      setToolWorkspaceHost({ getRootPath: () => process.cwd(), readFile: unused, writeFile: unused, stat: unused, createParentDirectory: unused, readDirectory: unused });
      const environment = await resolveCommandEnvironment();
      const command = `"${process.execPath}" -e "console.log('ready');setInterval(()=>{},1000)"`;
      const applications = new ManagedApplicationSessions(new AbortController().signal, "deactivation");
      const application = await applications.execute({ action: "start", command, wait_ms: 100 });
      assert.equal(application.status, "running"); assert.ok(application.pid);
      const terminal = startKeepAliveTerminal({ command, environment, conversationId: "deactivation" });
      assert.ok(terminal.pid); assert.equal(listKeepAliveTasks("deactivation").length, 1);
      const execution = executeShellCommand(command, environment);
      const resultPromise = execution.then(value => ({ value }));
      await new Promise(resolve => setTimeout(resolve, 100));
      let shutdowns = 0; const error = new Error("Provider failed to close");
      setActiveProvider({ shutdown: async () => { shutdowns++; if (failed) { throw error; } } } as unknown as WebviewProvider);
      if (failed) { await assert.rejects(deactivate(), caught => caught === error); } else { await deactivate(); }
      const result = await resultPromise;
      assert.notEqual(result.value.signal, null);
      for (const pid of [application.pid!, terminal.pid!]) {
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
      assert.deepEqual(listKeepAliveTasks("deactivation"), []);
      assert.throws(() => getKeepAliveTerminal(terminal.sessionId, "deactivation"), /Unknown keep-alive terminal/);
      await assert.rejects(applications.execute({ action: "status", session_id: application.sessionId }), /closed for this turn/);
      await deactivate(); assert.equal(shutdowns, 1);
    });
  }
});

import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";
import { shutdownConversationCommands } from "@/infrastructure/tools/builtins/terminal/ShellExecution";
import { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";

suite("Internal command execution", () => {
  test("runs commands in their requested directory without opening or activating VS Code terminals", async function () {
    this.timeout(15000);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(cwd);
    const id = randomUUID();
    const host = createVsCodeToolWorkspace(undefined, { conversationId: id });
    const options = { cwd, workspaceRoot: cwd, timeoutMs: 5000, maxOutputBytes: 4096 };
    const manual = vscode.window.createTerminal({ name: "User terminal: focus regression", cwd, isTransient: true });
    manual.show();
    const deadline = Date.now() + 5000;
    while (vscode.window.activeTerminal !== manual) {
      assert.ok(Date.now() < deadline, "User terminal did not become active");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const directory = vscode.Uri.joinPath(vscode.Uri.file(cwd), `.tmp/commands-${id} ' $(echo unexpected)`);
    let opened = 0; let changed = 0;
    const subscriptions = [vscode.window.onDidOpenTerminal(terminal => {if (terminal !== manual) {opened++;}}), vscode.window.onDidChangeActiveTerminal(terminal => {if (terminal !== manual) {changed++;}})];
    try {
      await vscode.workspace.fs.createDirectory(directory);
      const terminals = [...vscode.window.terminals];
      const active = vscode.window.activeTerminal;
      assert.equal((await host.executeCommand!("echo first-command", options)).exitCode, 0);
      const paginated = await host.executeCommand!("git --paginate help -a", options);
      assert.equal(paginated.exitCode, 0); assert.equal(paginated.timedOut, false);
      const shell = host.getCommandShell!();
      const pwd = /(?:^|[\\/])cmd(?:\.exe)?$/i.test(shell) ? "cd" : "pwd";
      const moved = await host.executeCommand!(pwd, { ...options, cwd: directory.fsPath });
      assert.equal(moved.exitCode, 0); assert.ok(moved.stdout.includes(directory.fsPath));
      const root = await host.executeCommand!(pwd, options);
      assert.equal(root.exitCode, 0); assert.ok(root.stdout.includes(cwd));
      assert.equal(opened, 0); assert.equal(changed, 0);
      assert.deepEqual([...vscode.window.terminals], terminals);
      assert.equal(vscode.window.activeTerminal, active);
    } finally {
      subscriptions.forEach(subscription => subscription.dispose());
      await shutdownConversationCommands(id); manual.dispose();
      await vscode.workspace.fs.delete(directory, { recursive: true });
    }
  });

  test("deleting a background chat stops only its command processes", async function () {
    this.timeout(15000);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; assert.ok(cwd);
    const first = randomUUID(); const second = randomUUID();
    const hosts = [first, second].map(conversationId => createVsCodeToolWorkspace(undefined, { conversationId }));
    const options = { cwd, workspaceRoot: cwd, timeoutMs: 10000, maxOutputBytes: 4096 };
    const markers = [first, second].map(id => vscode.Uri.joinPath(vscode.Uri.file(cwd), `.tmp/command-ready-${id}`));
    const commands = markers.map(marker => `node -e "require('node:fs').writeFileSync('${marker.fsPath.replace(/\\/g, '\\\\')}', 'ready');setInterval(()=>{},1000)"`);
    const executions = hosts.map((host, index) => host.executeCommand!(commands[index], options));
    let secondFinished = false; void executions[1].then(() => {secondFinished = true;});
    try {
      for (const marker of markers) {
        const deadline = Date.now() + 5000;
        while (!await vscode.workspace.fs.stat(marker).then(() => true, () => false)) {
          assert.ok(Date.now() < deadline, "Command did not start"); await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      const handler = { coordinator: { getActiveForConversation: () => undefined }, conversationState: { forget: () => false } } as unknown as ChatHandler;
      assert.equal(ChatHandler.prototype.forgetConversation.call(handler, first), false);
      const stopped = await executions[0]; assert.notEqual(stopped.exitCode, 0);
      assert.equal(secondFinished, false);
      await shutdownConversationCommands(second); await executions[1];
    } finally {
      await Promise.all([shutdownConversationCommands(first), shutdownConversationCommands(second)]);
      await Promise.allSettled(executions);
      await Promise.all(markers.map(uri => vscode.workspace.fs.delete(uri).then(() => undefined, () => undefined)));
    }
  });
});

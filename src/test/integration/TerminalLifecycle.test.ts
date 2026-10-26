import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { createVsCodeToolWorkspace } from "@/vscode/tools/VsCodeToolWorkspace";
import { closeConversationTerminals } from "@/vscode/tools/VsCodeTerminalExecution";
import { ChatHandler } from "@/vscode/webviews/handlers/chat/ChatHandler";

suite("Conversation terminal lifecycle", () => {
  test("reuses terminals within a chat and closes a deleted background chat without affecting others", async function () {
    this.timeout(30000);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(cwd);
    const first = randomUUID(); const second = randomUUID();
    const firstHost = createVsCodeToolWorkspace(undefined, { conversationId: first });
    const secondHost = createVsCodeToolWorkspace(undefined, { conversationId: second });
    const options = { cwd, workspaceRoot: cwd, timeoutMs: 5000, maxOutputBytes: 4096 };
    const owned = (id: string) => vscode.window.terminals.filter((terminal) =>
      (terminal.creationOptions as vscode.TerminalOptions).env?.YCRASY_AGENT_CONVERSATION_ID === id);
    const manual = vscode.window.createTerminal({ name: "Terminal lifecycle: user terminal", cwd, isTransient: true });
    const directory = vscode.Uri.joinPath(vscode.Uri.file(cwd), `terminal-lifecycle-${first} ' $(echo unexpected)`);
    try {
      await vscode.workspace.fs.createDirectory(directory);
      assert.equal((await firstHost.executeCommand!("echo first-chat", options)).exitCode, 0);
      const firstTerminal = owned(first)[0]; assert.ok(firstTerminal);
      assert.equal((await firstHost.executeCommand!("echo first-chat-again", options)).exitCode, 0);
      assert.deepEqual(owned(first), [firstTerminal]);
      const paginated = await firstHost.executeCommand!("git --paginate help -a", options);
      assert.equal(paginated.exitCode, 0);
      assert.equal(paginated.timedOut, false);
      assert.equal((await secondHost.executeCommand!("echo second-chat", options)).exitCode, 0);
      const secondTerminal = owned(second)[0]; assert.ok(secondTerminal);
      assert.notEqual(firstTerminal, secondTerminal);
      assert.equal((firstTerminal.creationOptions as vscode.TerminalOptions).isTransient, true);
      assert.equal((await firstHost.executeCommand!("echo another-directory", { ...options, cwd: directory.fsPath })).exitCode, 0);
      assert.deepEqual(owned(first), [firstTerminal]);
      assert.equal(firstTerminal.shellIntegration?.cwd?.fsPath, directory.fsPath);
      assert.equal((await firstHost.executeCommand!("echo back-at-root", options)).exitCode, 0);
      assert.deepEqual(owned(first), [firstTerminal]);
      assert.equal(firstTerminal.shellIntegration?.cwd?.fsPath, cwd);
      assert.equal((firstTerminal.creationOptions as vscode.TerminalOptions).env?.GIT_PAGER, "cat");

      const remaining = new Set(owned(first));
      const closed = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {subscription.dispose(); resolve();}, 5000);
        const subscription = vscode.window.onDidCloseTerminal((terminal) => {
          remaining.delete(terminal);
          if (remaining.size === 0) {clearTimeout(timer); subscription.dispose(); resolve();}
        });
      });
      // A deletion must clean up even when the chat was not currently selected.
      const handler = {
        coordinator: { getActiveForConversation: () => undefined },
        conversationState: { forget: () => false },
      } as unknown as ChatHandler;
      assert.equal(ChatHandler.prototype.forgetConversation.call(handler, first), false);
      await closed;
      assert.deepEqual(owned(first), []);
      assert.deepEqual(owned(second), [secondTerminal]);
      assert.ok(vscode.window.terminals.includes(manual));
      assert.equal((await secondHost.executeCommand!("echo still-open", options)).exitCode, 0);
    } finally {
      closeConversationTerminals(first); closeConversationTerminals(second); manual.dispose();
      await vscode.workspace.fs.delete(directory, { recursive: true });
    }
  });
});

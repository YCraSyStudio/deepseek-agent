import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Packaged VSIX smoke", () => {
  test("activates the installed artifact and resolves its chat command", async () => {
    const extension = vscode.extensions.getExtension("yarcrasy.deepseek-agent");
    assert.ok(extension);
    const expectedRoot = process.env.EXPECTED_PACKAGED_EXTENSION_ROOT;
    assert.ok(expectedRoot);
    assert.strictEqual(path.resolve(extension.extensionPath), path.resolve(expectedRoot));
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("deepseek-agent.openChat"));
    assert.ok(commands.includes("deepseek-agent.showDiagnostics"));
    await vscode.commands.executeCommand("deepseek-agent.openChat");
  });
});

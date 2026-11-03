import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { fileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";
import { ChatE2e, type PostedMessage } from "./support/ChatE2e";

suite("Tool flow", () => {
  let chat: ChatE2e | undefined;
  let createdUri: vscode.Uri | undefined;

  teardown(async () => {
    if (createdUri) {
      await vscode.workspace.fs.delete(createdUri, { useTrash: false }).then(() => undefined, () => undefined);
      createdUri = undefined;
    }
    await chat?.dispose();
    chat = undefined;
  });

  test("confirms a model edit, records the diff and reverts it through the tool", async () => {
    const fixture = await createFixture("alpha\n");
    chat = await ChatE2e.create();
    chat.transport
      .respond({ toolCalls: [{ name: "edit_file", arguments: { path: fixture.fileName, search: "alpha", replace: "beta" } }] })
      .respond({ text: "The note now says beta." });

    const generationId = await chat.startTurn(`Rename alpha to beta in ${fixture.fileName}`);
    const confirmation = await chat.waitForPostMatching(
      "toolCallConfirmationRequired",
      (post) => post.generationId === generationId,
    );
    const toolCall = firstToolCall(confirmation);
    assert.equal(toolCall.function.name, "edit_file");
    assert.equal(await fixture.read(), "alpha\n", "the edit must wait for the user decision");

    const result = await chat.settleToolCall(toolCall.id, generationId);
    assert.equal(result.status, "completed");
    assert.equal(await fixture.read(), "beta\n");

    const terminal = await chat.waitForTerminal(generationId);
    assert.equal(terminal.status, "completed");
    assert.ok(
      fileChangeRegistry.find(fixture.fileName, digest("alpha\n"), digest("beta\n")),
      "the applied edit must stay reviewable through the change registry",
    );
    const stored = await chat.history.getById(chat.conversationIdFor(generationId)!);
    const assistant = stored?.messages.find((message) => message.role === "assistant");
    assert.equal(assistant?.toolCalls?.[0]?.status, "completed");

    chat.transport
      .respond({ toolCalls: [{ name: "revert_workspace", arguments: { generationId } }] })
      .respond({ text: "The previous turn has been reverted." });
    const revertGeneration = await chat.startTurn("Undo that edit", {
      conversationId: chat.conversationIdFor(generationId),
    });
    const revertConfirmation = await chat.waitForPostMatching(
      "toolCallConfirmationRequired",
      (post) => post.generationId === revertGeneration,
    );
    const revertCall = firstToolCall(revertConfirmation);
    const revertResult = await chat.settleToolCall(revertCall.id, revertGeneration);
    assert.match(String(revertResult.result), /Reverted turn/);
    assert.equal((await chat.waitForTerminal(revertGeneration)).status, "completed");
    assert.equal(await fixture.read(), "alpha\n");
  });

  test("rejects a destructive edit without touching the file", async () => {
    const fixture = await createFixture("alpha\n");
    chat = await ChatE2e.create();
    chat.transport
      .respond({ toolCalls: [{ name: "edit_file", arguments: { path: fixture.fileName, search: "alpha", replace: "destroyed" } }] })
      .respond({ text: "The edit was not applied." });

    const generationId = await chat.startTurn(`Overwrite ${fixture.fileName}`);
    const confirmation = await chat.waitForPostMatching(
      "toolCallConfirmationRequired",
      (post) => post.generationId === generationId,
    );
    const toolCall = firstToolCall(confirmation);
    const result = await chat.settleToolCall(toolCall.id, generationId, "reject");

    assert.equal(result.status, "rejected");
    assert.match(String(result.result), /rejected by user/i);
    assert.equal(await fixture.read(), "alpha\n");
    assert.equal((await chat.waitForTerminal(generationId)).status, "completed");
  });

  async function createFixture(content: string): Promise<{
    fileName: string;
    read(): Promise<string>;
  }> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const fileName = `e2e-tool-${randomUUID()}.txt`;
    createdUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
    await vscode.workspace.fs.writeFile(createdUri, Buffer.from(content));
    return {
      fileName,
      read: async () => Buffer.from(await vscode.workspace.fs.readFile(createdUri!)).toString("utf8"),
    };
  }
});

function firstToolCall(post: PostedMessage): { id: string; function: { name: string; arguments: string } } {
  const toolCalls = Array.isArray(post.toolCalls)
    ? post.toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>
    : [];
  const [first] = toolCalls;
  if (!first) {throw new Error("The confirmation event did not include a tool call");}
  return first;
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

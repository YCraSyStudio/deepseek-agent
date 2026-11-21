import assert from "node:assert/strict";
import { currentWorkspaceId, evaluateDeterministicSafety } from "@/vscode/webviews/handlers/chat/toolCalls/DeterministicSafety";
import { setToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import type { ToolCall } from "@/contracts";

suite("deterministic safety evaluation", () => {
  const scope = { conversationId: "chat", workspaceId: "workspace", permissionFingerprint: "fingerprint" };
  const toolCall = (name: string, args: Record<string, unknown> = { command: "git status" }): ToolCall => ({
    id: "call", type: "function", function: { name, arguments: JSON.stringify(args) },
  });
  const confirmation = (patch: Partial<ConfirmationRequiredResult> = {}): ConfirmationRequiredResult => ({
    requiresConfirmation: true, dangerLevel: "safe", warningMessage: "Confirm", ...patch,
  });

  test("classifies non-mutating and unknown-file mutations as review", async () => {
    const unrelated = await evaluateDeterministicSafety({ toolCall: toolCall("read_file"), confirmation: confirmation(), scope });
    assert.equal(unrelated.verdict.kind, "review");
    const missingPath = await evaluateDeterministicSafety({ toolCall: toolCall("edit_file"), effect: "workspace-mutation", confirmation: confirmation({ workspaceContained: true }), scope });
    assert.equal(missingPath.verdict.code, "path-unknown");
    assert.equal(missingPath.key, undefined);
  });

  test("approves a contained non-sensitive file mutation and caches its decision", async () => {
    const result = await evaluateDeterministicSafety({
      toolCall: toolCall("edit_file"), effect: "workspace-mutation", scope,
      confirmation: confirmation({ filePath: "src/a.ts", workspaceContained: true, beforeHash: "hash" }),
    });
    assert.equal(result.verdict.kind, "approve");
    assert.equal(typeof result.key, "string");
    const outside = await evaluateDeterministicSafety({
      toolCall: toolCall("create_file"), effect: "workspace-mutation", scope,
      confirmation: confirmation({ filePath: "src/a.ts", workspaceContained: false }),
    });
    assert.equal(outside.verdict.kind, "review");
    const sensitive = await evaluateDeterministicSafety({
      toolCall: toolCall("create_file"), effect: "workspace-mutation", scope,
      confirmation: confirmation({ filePath: ".env", workspaceContained: true }),
    });
    assert.equal(sensitive.verdict.code, "sensitive-path");
  });

  test("classifies read-only commands, unknown commands and ordinary scripts", async () => {
    const diagnostic = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command"), confirmation: confirmation({ command: "git --version" }), scope });
    assert.equal(diagnostic.verdict.kind, "approve");
    const unknown = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", {}), confirmation: confirmation(), scope });
    assert.equal(unknown.verdict.code, "command-unknown");
    const broken = await evaluateDeterministicSafety({ toolCall: { ...toolCall("run_terminal_command"), function: { name: "run_terminal_command", arguments: "{" } }, confirmation: confirmation(), scope });
    assert.equal(broken.verdict.code, "command-unknown");
    const script = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "node scripts/build.js" }), confirmation: confirmation({ cwd: "/workspace" }), scope });
    assert.equal(script.verdict.kind, "review");
    const other = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "npm test" }), confirmation: confirmation(), scope });
    assert.equal(other.verdict.kind, "review");
    assert.equal(typeof other.key, "string");
  });

  test("reads a contained script, rejects unreadable and binary files and identifies the workspace", async () => {
    let content = new TextEncoder().encode("console.log('build')");
    let readFails = false;
    setToolWorkspaceHost({
      getRootPath: () => "/workspace",
      getWorkspaceId: () => "workspace",
      isPathInsideWorkspace: async () => true,
      readFile: async () => { if (readFails) { throw new Error("unreadable"); } return content; },
    } as unknown as ToolWorkspaceHost);
    assert.equal(currentWorkspaceId(), "workspace");
    const contained = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "node scripts/build.js" }), confirmation: confirmation({ cwd: "/workspace" }), scope });
    assert.equal(contained.verdict.kind, "review");
    assert.equal(typeof contained.key, "string");
    readFails = true;
    const unreadable = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "node scripts/build.js" }), confirmation: confirmation({ cwd: "/workspace" }), scope });
    assert.equal(unreadable.verdict.kind, "review");
    content = new Uint8Array([0x00, 0x01]);
    readFails = false;
    const binary = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "node scripts/build.js" }), confirmation: confirmation({ cwd: "/workspace" }), scope });
    assert.equal(binary.verdict.kind, "review");
  });

  test("rejects scripts outside the workspace and treats missing hosts as unknown", async () => {
    setToolWorkspaceHost({
      getRootPath: () => "/workspace",
      isPathInsideWorkspace: async () => false,
      readFile: async () => new Uint8Array(),
    } as unknown as ToolWorkspaceHost);
    const outside = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "node scripts/build.js" }), confirmation: confirmation({ cwd: "/workspace" }), scope });
    assert.equal(outside.verdict.kind, "review");
    setToolWorkspaceHost({
      getRootPath: () => "/workspace",
      readFile: async () => new Uint8Array(),
    } as unknown as ToolWorkspaceHost);
    const missingHost = await evaluateDeterministicSafety({ toolCall: toolCall("run_terminal_command", { command: "node scripts/build.js" }), confirmation: confirmation({ cwd: "/workspace" }), scope });
    assert.equal(missingHost.verdict.kind, "review");
    assert.equal(currentWorkspaceId(), undefined);
  });

  test("reviews path changes when Git recovery cannot prove the file is safe", async () => {
    const missing = await evaluateDeterministicSafety({ toolCall: toolCall("move_path"), effect: "workspace-mutation", confirmation: confirmation(), scope });
    assert.equal(missing.verdict.code, "path-unknown");
    const outside = await evaluateDeterministicSafety({
      toolCall: toolCall("delete_path"), effect: "workspace-mutation", scope,
      confirmation: confirmation({ filePath: "/tmp/outside.txt", workspaceRoot: "/tmp" }),
    });
    assert.equal(outside.verdict.kind, "review");
  });

  test("fails closed when its own facts cannot be evaluated", async () => {
    const result = await evaluateDeterministicSafety({
      toolCall: toolCall("edit_file"), effect: "workspace-mutation", scope,
      confirmation: confirmation({ filePath: 5 as unknown as string, workspaceContained: true }),
    });
    assert.deepEqual(result, { verdict: { kind: "review", code: "facts-unavailable", facts: {} } });
  });
});

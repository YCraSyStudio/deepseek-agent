import * as assert from "node:assert";
import * as path from "node:path";
import {
  getTerminalLifecycleError,
  getTerminalRoutingError,
  normalizeLeadingDirectoryChange,
  terminalCommandHandler,
  terminalCommandHandlerForced,
} from "@/infrastructure/tools/builtins/terminal/TerminalCommand";
import { setToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { listKeepAliveTasks, onKeepAliveTerminalsChanged } from "@/infrastructure/tools/builtins/terminal/KeepAliveTerminals";

suite("terminal command confirmation", () => {
  test("includes the exact command and resolved execution environment", async () => {
    setToolWorkspaceHost({
      getRootPath: () => process.cwd(),
      realPath: async (value) => value,
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
      stat: async () => ({ type: "file", size: 0 }),
      createParentDirectory: async () => undefined,
      readDirectory: async () => [],
    });
    const command = "echo unsafe >> output.txt";

    const raw = await terminalCommandHandler({ command });
    const confirmation = JSON.parse(raw) as Record<string, unknown>;

    assert.strictEqual(confirmation.requiresConfirmation, true);
    assert.strictEqual(confirmation.command, command);
    assert.strictEqual(typeof confirmation.cwd, "string");
    assert.strictEqual(confirmation.workspaceRoot, process.cwd());
    assert.strictEqual(typeof confirmation.shell, "string");
    assert.strictEqual(typeof confirmation.reasonCode, "string");
  });

  test("moves a leading cd into the structured cwd argument", () => {
    assert.deepStrictEqual(
      normalizeLeadingDirectoryChange("cd frontend && npm install"),
      { command: "npm install", cwd: "frontend" },
    );
    assert.deepStrictEqual(
      normalizeLeadingDirectoryChange('cd /d "apps/frontend" && npm run build', "project"),
      { command: "npm run build", cwd: path.join("project", "apps/frontend") },
    );
  });

  test("does not rewrite compound commands that do not begin with directory navigation", () => {
    const command = "mkdir project && cd project && npm install";
    assert.deepStrictEqual(normalizeLeadingDirectoryChange(command), { command, cwd: undefined });
  });

  test("routes workspace inspection away from terminal when dedicated tools are available", () => {
    const context = {
      trustedUserRequest: "review the project",
      availableToolNames: ["list_directory", "read_file", "search_content", "edit_file"],
    };

    assert.match(getTerminalRoutingError("dir src", context) ?? "", /Use list_directory/);
    assert.match(getTerminalRoutingError("type package.json", context) ?? "", /Use read_file/);
    assert.match(getTerminalRoutingError("findstr DeepSeek README.md", context) ?? "", /Use search_content/);
    assert.match(
      getTerminalRoutingError('powershell -Command "$bytes=[IO.File]::ReadAllBytes(\'App.css\'); $crlf=0"', context) ?? "",
      /without line-ending probes/,
    );
  });

  test("keeps executable workflows and explicit terminal requests available", () => {
    const availableToolNames = ["list_directory", "read_file", "search_content"];

    assert.strictEqual(getTerminalRoutingError("npm run build", { availableToolNames }), undefined);
    assert.strictEqual(getTerminalRoutingError("git status --short", { availableToolNames }), undefined);
    assert.strictEqual(getTerminalRoutingError("dir src", {
      availableToolNames,
      trustedUserRequest: "usa la terminal para listar src",
    }), undefined);
    assert.match(getTerminalRoutingError("dir src", {
      availableToolNames,
      trustedUserRequest: "sin terminal, revisa src",
    }) ?? "", /Use list_directory/);
  });

  test("rejects process launchers that can escape the owned terminal lifecycle", () => {
    assert.match(getTerminalLifecycleError(
      "powershell -NoProfile -Command \"$p = Start-Process dotnet -PassThru\"",
    ) ?? "", /background process launch rejected/);
    assert.match(getTerminalLifecycleError("start /b dotnet run") ?? "", /background process launch rejected/);
    assert.match(getTerminalLifecycleError("nohup npm run dev &") ?? "", /background process launch rejected/);
    assert.match(getTerminalLifecycleError("dotnet run 2>&1 &\nsleep 8\ncurl http://localhost:5014") ?? "", /background process launch rejected/);
    assert.strictEqual(getTerminalLifecycleError("dotnet build && dotnet test"), undefined);
    assert.strictEqual(getTerminalLifecycleError("dotnet build"), undefined);
    assert.strictEqual(getTerminalLifecycleError("npm start"), undefined);
  });

  test("leaves the persistence decision to the safety review instead of keyword matching", async () => {
    setToolWorkspaceHost({
      getRootPath: () => process.cwd(),
      realPath: async (value) => value,
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
      stat: async () => ({ type: "file", size: 0 }),
      createParentDirectory: async () => undefined,
      readDirectory: async () => [],
    });

    for (const request of [
      "run the dev server",
      "levanta el servidor pero no lo dejes abierto",
      "deja las herramientas activas",
      "keep these tools alive",
    ]) {
      const confirmation = JSON.parse(await terminalCommandHandler(
        { command: "npm run dev", keepAlive: true },
        { trustedUserRequest: request },
      )) as Record<string, unknown>;
      assert.strictEqual(confirmation.requiresConfirmation, true);
      assert.strictEqual(confirmation.keepAlive, true);
    }

    assert.match(await terminalCommandHandler({ command: "npm run dev", keepAlive: "yes" }), /keepAlive must be a boolean/);
    assert.match(
      await terminalCommandHandler({ command: "npm run dev", keepAlive: true, keepAliveAction: "stop" }),
      /mutually exclusive/,
    );
  });

  test("validates keep-alive control calls before touching a process", async () => {
    const missingId = await terminalCommandHandler({ keepAliveAction: "stop" });
    assert.match(missingId, /requires the keepAliveSessionId/);

    await assert.rejects(async () => terminalCommandHandler({ keepAliveAction: "restart" }), /status.*stop/);
  });

  test("starts and stops an isolated keep-alive terminal", async () => {
    setToolWorkspaceHost({
      getRootPath: () => process.cwd(),
      realPath: async (value) => value,
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
      stat: async () => ({ type: "file", size: 0 }),
      createParentDirectory: async () => undefined,
      readDirectory: async () => [],
    });
    const context = { conversationId: `keep-alive-${process.pid}`, trustedUserRequest: "keep it running" };
    const notifications: string[] = [];
    const unsubscribe = onKeepAliveTerminalsChanged((conversationId) => notifications.push(conversationId));
    const started = JSON.parse(await terminalCommandHandlerForced(
      { command: 'node -e "setInterval(()=>{}, 1000)"', keepAlive: true },
      context,
    )) as { kind: string; sessionId: string; status: string };
    assert.strictEqual(started.kind, "keep_alive_terminal");
    assert.strictEqual(started.status, "running");
    assert.strictEqual(typeof started.sessionId, "string");

    const running = listKeepAliveTasks(context.conversationId);
    assert.strictEqual(running.length, 1);
    assert.strictEqual(running[0].id, started.sessionId);
    assert.strictEqual(typeof running[0].pid, "number");
    assert.match(running[0].name, /node/);
    assert.deepStrictEqual(listKeepAliveTasks("another-conversation"), []);

    const stopped = JSON.parse(await terminalCommandHandlerForced(
      { keepAliveAction: "stop", keepAliveSessionId: started.sessionId },
      context,
    )) as { status: string; terminationConfirmed: boolean };
    unsubscribe();

    assert.strictEqual(stopped.status, "stopped");
    assert.strictEqual(stopped.terminationConfirmed, true);
    assert.deepStrictEqual(listKeepAliveTasks(context.conversationId), []);
    assert.ok(notifications.includes(context.conversationId));
  });
});

import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolHandlerContext, ToolMetadata } from "@/application/tools/Types";
import { executeWorkspaceCommand, resolveCommandEnvironment } from "./ShellExecution";
import {
  getKeepAliveTerminal,
  startKeepAliveTerminal,
  stopKeepAliveTerminal,
} from "./KeepAliveTerminals";
import * as path from "node:path";

async function handleTerminalCommand(args: Record<string, unknown>, context?: ToolHandlerContext): Promise<string> {
  const keepAliveAction = readKeepAliveAction(args);
  if (keepAliveAction) {
    return controlKeepAliveTerminal(keepAliveAction, args, context);
  }
  const normalized = normalizeLeadingDirectoryChange(
    typeof args.command === "string" ? args.command : "",
    typeof args.cwd === "string" ? args.cwd : undefined,
  );
  const command = normalized.command;
  const cwd = normalized.cwd;

  if (!command) {
    return "Error: command parameter is required";
  }
  const lifecycleError = getTerminalLifecycleError(command);
  if (lifecycleError) {
    return lifecycleError;
  }
  const routingError = getTerminalRoutingError(command, context);
  if (routingError) {
    return routingError;
  }
  const keepAliveError = getKeepAliveError(args);
  if (keepAliveError) {
    return keepAliveError;
  }

  const environment = await resolveCommandEnvironment(cwd);
  return JSON.stringify({
    requiresConfirmation: true,
    dangerLevel: "caution",
    warningMessage: args.keepAlive === true
      ? "Launch an isolated keep-alive terminal that outlives this turn until it is stopped, the chat is deleted, the extension shuts down, or four hours pass. It requires an independent DeepSeek safety review."
      : "This terminal command requires an independent DeepSeek safety review.",
    command,
    keepAlive: args.keepAlive === true,
    cwd: environment.cwd,
    workspaceRoot: environment.workspaceRoot,
    shell: environment.shell,
    reasonCode: "remote-review-required",
  });
}

async function handleTerminalCommandForced(args: Record<string, unknown>, context?: ToolHandlerContext): Promise<string> {
  const keepAliveAction = readKeepAliveAction(args);
  if (keepAliveAction) {
    return controlKeepAliveTerminal(keepAliveAction, args, context);
  }
  const normalized = normalizeLeadingDirectoryChange(
    typeof args.command === "string" ? args.command : "",
    typeof args.cwd === "string" ? args.cwd : undefined,
  );
  const command = normalized.command;
  const cwd = normalized.cwd;
  const timeoutMs = args.timeoutMs as number | undefined;
  const maxOutputBytes = args.maxOutputBytes as number | undefined;

  if (!command) {
    return "Error: command parameter is required";
  }
  const lifecycleError = getTerminalLifecycleError(command);
  if (lifecycleError) {
    return lifecycleError;
  }
  const routingError = getTerminalRoutingError(command, context);
  if (routingError) {
    return routingError;
  }
  const keepAliveError = getKeepAliveError(args);
  if (keepAliveError) {
    return keepAliveError;
  }

  if (args.keepAlive === true) {
    const environment = await resolveCommandEnvironment(cwd);
    return JSON.stringify(startKeepAliveTerminal({ command, environment, conversationId: context?.conversationId }));
  }
  return JSON.stringify(await executeWorkspaceCommand(command, { cwd, signal: context?.signal, timeoutMs, maxOutputBytes }));
}

type KeepAliveAction = "status" | "stop";

function readKeepAliveAction(args: Record<string, unknown>): KeepAliveAction | undefined {
  if (args.keepAliveAction === undefined) {
    return undefined;
  }
  if (args.keepAliveAction === "status" || args.keepAliveAction === "stop") {
    return args.keepAliveAction;
  }
  throw new Error('keepAliveAction must be "status" or "stop"');
}

function getKeepAliveError(args: Record<string, unknown>): string | undefined {
  if (args.keepAlive === undefined) {
    return undefined;
  }
  if (typeof args.keepAlive !== "boolean") {
    return "Error: keepAlive must be a boolean";
  }
  if (!args.keepAlive) {
    return undefined;
  }
  if (args.keepAliveAction !== undefined) {
    return "Error: keepAlive and keepAliveAction are mutually exclusive; use keepAlive: true to start a session, or keepAliveAction with keepAliveSessionId to inspect or stop one.";
  }
  return undefined;
}

function controlKeepAliveTerminal(
  action: KeepAliveAction,
  args: Record<string, unknown>,
  context?: ToolHandlerContext,
): Promise<string> {
  if (args.keepAlive === true) {
    return Promise.resolve(`Error: keepAlive and keepAliveAction are mutually exclusive; omit keepAlive for the "${action}" control action`);
  }
  const sessionId = typeof args.keepAliveSessionId === "string" ? args.keepAliveSessionId.trim() : "";
  if (!sessionId) {
    return Promise.resolve(`Error: keepAliveAction "${action}" requires the keepAliveSessionId returned by the keepAlive start call`);
  }
  const conversationId = context?.conversationId;
  try {
    return action === "stop"
      ? stopKeepAliveTerminal(sessionId, conversationId).then((result) => JSON.stringify(result))
      : Promise.resolve(JSON.stringify(getKeepAliveTerminal(sessionId, conversationId)));
  } catch (error) {
    return Promise.resolve(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const TERMINAL_REQUEST = /\b(?:use|run|execute|via|from|in|usa|usar|utiliza|ejecuta|mediante|desde|en)\b.{0,24}\b(?:terminal|shell|powershell|pwsh|cmd(?:\.exe)?|bash|zsh)\b/i;
const TERMINAL_REJECTION = /\b(?:without|no|do not|don't|sin)\b.{0,16}\b(?:terminal|shell|powershell|pwsh|cmd(?:\.exe)?|bash|zsh)\b/i;

const DETACHED_PROCESS_PATTERNS = [
  /[ \t]&[ \t]*(?:\r?\n|$)/,
  /\bStart-(?:Process|Job|ThreadJob)\b/i,
  /\b(?:nohup|disown|setsid)\b/i,
  /\bwmic(?:\.exe)?\s+process\s+call\s+create\b/i,
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\r\n]*\s-AsJob\b/i,
  /(?:^|[;&|]\s*|\bcmd(?:\.exe)?\s+\/[ck]\s+)start(?:\s+"[^"]*")?\s+(?!\/wait\b)/i,
];

export function getTerminalLifecycleError(command: string): string | undefined {
  if (!DETACHED_PROCESS_PATTERNS.some((pattern) => pattern.test(command))) {return undefined;}
  return "Error: background process launch rejected. run_terminal_command owns one finite foreground process tree; do not use Start-Process, start, jobs, nohup, disown, or similar detachment. For a GUI/server that must stay alive during a capture, use application_session action=start with its foreground command, capture_screenshot, then action=stop. For a user-requested process that must outlive the turn, run the foreground command again with keepAlive=true.";
}

export function getTerminalRoutingError(command: string, context?: ToolHandlerContext): string | undefined {
  const available = new Set(context?.availableToolNames ?? []);
  if (available.size === 0 || explicitlyRequestsTerminal(context?.trustedUserRequest)) {
    return undefined;
  }

  const segmentStart = String.raw`(?:^|&&|\|\||[;&])\s*`;
  const routes: Array<{ tool: string; pattern: RegExp; purpose: string }> = [
    {
      tool: "list_directory",
      pattern: new RegExp(`${segmentStart}(?:dir|ls|gci|get-childitem|get-child-item)\\b`, "i"),
      purpose: "workspace file discovery",
    },
    {
      tool: "read_file",
      pattern: new RegExp(`${segmentStart}(?:type|cat|head|tail|gc|get-content)\\b`, "i"),
      purpose: "reading workspace files",
    },
    {
      tool: "search_content",
      pattern: new RegExp(`${segmentStart}(?:findstr|grep|rg|select-string)\\b`, "i"),
      purpose: "searching workspace content",
    },
  ];
  const route = routes.find((candidate) => available.has(candidate.tool) && candidate.pattern.test(command));
  if (route) {
    return `Error: terminal routing rejected. Use ${route.tool} for ${route.purpose}; reserve run_terminal_command for builds, tests, Git, package managers, and other executable workflows.`;
  }

  if (/\b(?:readallbytes|dos2unix|unix2dos)\b|\bcrlf\s*=|line[ -]?endings?/i.test(command)) {
    const editingTool = ["edit_file", "apply_patch", "read_file"].find((name) => available.has(name));
    if (editingTool) {
      return `Error: terminal routing rejected. ${editingTool} handles workspace text without line-ending probes; do not inspect or convert LF/CRLF.`;
    }
  }
  return undefined;
}

function explicitlyRequestsTerminal(request: string | undefined): boolean {
  return Boolean(request && !TERMINAL_REJECTION.test(request) && TERMINAL_REQUEST.test(request));
}

export function normalizeLeadingDirectoryChange(
  command: string,
  cwd?: string,
): { command: string; cwd?: string } {
  if (!command) {
    return { command, cwd };
  }
  const match = command.match(
    /^\s*cd(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|([^&|;\r\n]+?))\s*&&\s*(.+)$/i,
  );
  if (!match) {
    return { command, cwd };
  }
  const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const remainingCommand = (match[4] ?? "").trim();
  if (!target || !remainingCommand) {
    return { command, cwd };
  }
  const normalizedCwd = cwd && !path.isAbsolute(target)
    ? path.join(cwd, target)
    : target;
  return { command: remainingCommand, cwd: normalizedCwd };
}

export const terminalCommandDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "run_terminal_command",
    description:
      "Run one executable workflow such as a build, test, Git operation, or package-manager command. By default the tool waits until the command EXITS and tools run sequentially. To keep a GUI/server alive while capturing it, build here then use application_session action=start, capture_screenshot and application_session action=stop; never queue capture behind a timed foreground preview. When the user explicitly asks to keep a server or tool running after the turn, set keepAlive=true with the foreground command: it starts an isolated terminal owned by this chat, returns immediately with a sessionId, and stays alive across turns until keepAliveAction=stop, chat deletion, extension shutdown, or four hours. Use keepAliveAction=status or stop with that keepAliveSessionId to inspect or end it. When file tools are available, never use shell commands or inline scripts to list, read, search, edit, check, or inspect line endings in workspace files. Stay inside the workspace unless the user explicitly requests external computer access and the active permission mode allows it. Never use Start-Process, start, jobs, nohup, disown, or any mechanism that detaches a process. The structured result is authoritative; do not add verification-only reads unless output is ambiguous or verification was requested. Commands cannot answer prompts or use a TTY.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Executable workflow to run; not a substitute for dedicated workspace file tools. Required unless keepAliveAction is status or stop.",
        },
        cwd: {
          type: "string",
          description: "Working directory relative to the workspace. Use an absolute path only for explicitly requested external access. Prefer this argument over cd.",
        },
        timeoutMs: {
          type: "integer",
          description: "Timeout in milliseconds (1000-120000). Defaults to 30000. Ignored by keep-alive sessions, which are bounded to four hours.",
          minimum: 1000,
          maximum: 120000,
        },
        maxOutputBytes: {
          type: "integer",
          description: "Maximum bytes retained per stdout/stderr stream (4096-4194304).",
          minimum: 4096,
          maximum: 4194304,
        },
        keepAlive: {
          type: "boolean",
          description: "Start an isolated terminal that survives this turn. Only when the user explicitly asks to keep the process or tool running; it returns a sessionId immediately and is stopped by keepAliveAction=stop, chat deletion, extension shutdown, or four hours.",
        },
        keepAliveAction: {
          type: "string",
          enum: ["status", "stop"],
          description: "Control an existing keep-alive terminal: status returns its retained output, stop terminates its process tree. Requires keepAliveSessionId and no command.",
        },
        keepAliveSessionId: {
          type: "string",
          description: "SessionId returned by a keepAlive start; only valid for keepAliveAction status or stop in the same chat.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const terminalCommandHandler: RegisteredTool["handler"] = handleTerminalCommand;
export const terminalCommandHandlerForced: RegisteredTool["handler"] = handleTerminalCommandForced;

export const terminalCommandMetadata: ToolMetadata = {
  dangerLevel: "dangerous",
  warningMessage: "Shell commands can modify, delete, or damage files. Review the command carefully before executing.",
  requiresConfirmation: true,
};

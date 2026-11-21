import type { ApplicationSessionRequest } from "@/contracts/ApplicationSession";
import type { RegisteredTool, ToolHandlerContext } from "@/application/tools/Types";
import { resolveApplicationEnvironment } from "./ManagedApplicationSessions";
import { getTerminalLifecycleError, getTerminalRoutingError } from "./TerminalCommand";

function validate(args: Record<string, unknown>): ApplicationSessionRequest {
  if (!["start", "status", "stop"].includes(String(args.action))) {throw new Error("action must be start, status or stop");}
  if (args.wait_ms !== undefined && (!Number.isSafeInteger(args.wait_ms) || Number(args.wait_ms) < 0 || Number(args.wait_ms) > 10_000)) {throw new Error("wait_ms must be between 0 and 10000");}
  if (args.action === "start") {
    if (typeof args.command !== "string" || !args.command.trim() || args.command.length > 32_768 || args.command.includes("\0")) {throw new Error("start requires a nonempty command");}
    if (args.cwd !== undefined && (typeof args.cwd !== "string" || !args.cwd.trim())) {throw new Error("Invalid application cwd");}
    if (args.session_id !== undefined) {throw new Error("start does not accept session_id");}
  } else {
    if (typeof args.session_id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(args.session_id)) {throw new Error("status/stop requires an application session_id returned by start");}
    if (args.command !== undefined || args.cwd !== undefined) {throw new Error("status/stop accepts a session_id, not a command or cwd");}
  }
  return args as unknown as ApplicationSessionRequest;
}

async function handle(args: Record<string, unknown>, context?: ToolHandlerContext, forced = false): Promise<string> {
  const request = validate(args);
  if (!context?.applicationSession) {throw new Error("Managed application sessions are unavailable in this generation");}
  if (request.action === "start") {
    const error = getTerminalLifecycleError(request.command) ?? getTerminalRoutingError(request.command, context);
    if (error) {return error;}
    const environment = await resolveApplicationEnvironment(request.cwd);
    if (!forced) {
      return JSON.stringify({ requiresConfirmation: true, dangerLevel: "caution",
        warningMessage: "Launch a managed application process for visual testing. It remains owned by this turn and is stopped when the turn ends, is cancelled, or reaches 10 minutes.",
        command: request.command, ...environment, reasonCode: "remote-review-required" });
    }
  }
  const result = await context.applicationSession(request);
  if (request.action === "start" && result.status !== "running") {return `Error: application launch ended before capture. ${JSON.stringify(result)}`;}
  return JSON.stringify(result);
}

export const applicationSessionTool: RegisteredTool = {
  definition: { type: "function", function: { name: "application_session", strict: true,
    description: "Launch and control a managed application or local preview for visual testing. Tools execute SEQUENTIALLY: run_terminal_command waits until its command exits, so never launch a GUI/server there with timeout and queue its capture behind it. Instead build with run_terminal_command, then action=start with a foreground launch command (prefer a prebuilt executable, no timeout, tail pipeline or detached/background launcher). start returns sessionId promptly while the application stays alive; use capture_screenshot in the next call. A running process does not prove a window is ready: inspect bounded startup logs or use action=status with wait_ms (0-10000) if needed. On Wayland the user selects the window in the system chooser. action=stop closes only this turn's owned session; always stop after testing. Sessions run on the extension host, are limited to 3 running/8 launches per turn and 10 minutes, and are closed at turn end, cancellation, chat deletion or extension shutdown. No arbitrary PID control. Never claim startup or visual validation from process metadata alone.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["start", "status", "stop"] },
      command: { type: "string", description: "start only: foreground application command; do not wrap in timeout or redirect output through tail." },
      cwd: { type: "string", description: "start only: working directory, using the same workspace path rules as terminal commands." },
      session_id: { type: "string", description: "status/stop only: exact sessionId returned by start in this turn." },
      wait_ms: { type: "integer", minimum: 0, maximum: 10000, description: "Bounded startup/status observation delay; start defaults to 1000 ms. Does not wait for application exit." },
    }, required: ["action"], additionalProperties: false },
  } },
  metadata: { dangerLevel: "dangerous", requiresConfirmation: true, effect: "external-effect" },
  handler: (args, context) => handle(args, context),
  forcedHandler: (args, context) => handle(args, context, true),
};

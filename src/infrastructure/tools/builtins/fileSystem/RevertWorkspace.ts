import type { RegisteredTool } from "@/application/tools/Types";

export const revertWorkspaceTool: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "revert_workspace",
      description: "Restore the files changed by a completed turn in this chat to their state before that user message, using real local recovery copies. Use when the user asks to undo/revert an agent turn. Preserves pre-existing changes and refuses to overwrite subsequent edits. Omit generationId to revert the latest unreverted turn. Does not reset Git commits or the index. Unavailable in incognito mode.",
      strict: true,
      parameters: { type: "object", properties: { generationId: { type: "string", description: "Optional completed generation id; omit for the latest unreverted turn." } }, required: [], additionalProperties: false },
    },
  },
  metadata: { dangerLevel: "caution", requiresConfirmation: true, scope: "workspace", effect: "workspace-mutation" },
  handler: async () => JSON.stringify({ requiresConfirmation: true, dangerLevel: "caution", warningMessage: "Restore the changed files to their state before the selected turn? Subsequent edits will not be overwritten." }),
  forcedHandler: async (args, context) => {
    if (!context?.revertWorkspace) {return "Error: recovery snapshots are unavailable in this workspace";}
    if (args.generationId !== undefined && (typeof args.generationId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(args.generationId))) {return "Error: invalid recovery turn id";}
    try {return await context.revertWorkspace(args.generationId as string | undefined);}
    catch (error) {return `Error reverting workspace: ${error instanceof Error ? error.message : String(error)}`;}
  },
};

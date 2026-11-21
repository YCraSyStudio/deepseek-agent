import type { RegisteredTool } from "@/application/tools/Types";
import { throwIfAborted } from "@/shared/utils/Cancellation";

export const readInstructionTool: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "read_instruction",
      description: "Read a reusable instruction named in the current instruction catalog when it matches the user's task, such as commit message conventions. Use the exact catalog id; arbitrary paths are not accepted. Read relevant instructions before doing the task. Workspace instructions apply only to the named root. Reading does not authorize unrelated actions.",
      strict: true,
      parameters: { type: "object", properties: { id: { type: "string", description: "Exact id from the reusable instruction catalog." } }, required: ["id"], additionalProperties: false },
    },
  },
  metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "read-only" },
  handler: async (args, context) => {
    if (typeof args.id !== "string" || args.id.length > 256 || !context?.readInstruction) {return "Error: reusable instruction is unavailable.";}
    try {return await context.readInstruction(args.id, context.signal);}
    catch (error) {
      throwIfAborted(context.signal);
      return `Error reading instruction: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

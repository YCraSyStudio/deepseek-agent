import type { RegisteredTool } from "@/application/tools/Types";

export const viewImageTool: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "view_image",
      description: "Reopen saved images from this conversation by their image numbers or screenshot ids. Their actual pixels are supplied as native visual file parts in the next tool round. Use when a previous image is not visible in your current context, before declaring it unavailable. This retrieves the original image, not a new screenshot. Never substitute another image if retrieval fails.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          screenshot_ids: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" },
            description: "Conversation image numbers or ids, e.g. [\"1\", \"screenshot-3\"]." },
        },
        required: ["screenshot_ids"],
        additionalProperties: false,
      },
    },
  },
  metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global" },
  handler: async (args, context) => {
    const ids = args.screenshot_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 8 || !ids.every(id => typeof id === "string" && /^(?:screenshot-)?[1-9]\d*$/.test(id))) {
      return "Error: supply 1–8 conversation image numbers or screenshot ids.";
    }
    if (!context?.analyzeImages) {return "Error: saved image retrieval is unavailable in this generation.";}
    return context.analyzeImages({ question: "Inspect the saved conversation images directly.", screenshotIds: [...new Set(ids)] }, context.signal);
  },
};

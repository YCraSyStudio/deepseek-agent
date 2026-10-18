import type { RegisteredTool } from "@/application/tools/Types";

export const analyzeImagesTool: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "analyze_images",
      description: "Delegate visual analysis to DeepSeek V4.1 Flash when the current model cannot read images natively. Inspect message attachments, stored screenshots or workspace image files. Use screenshot_ids (or latest) after capture_screenshot to review UI output. Workspace images are explicitly uploaded only when this tool is called. The result is a text description for the current model.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The precise visual question to answer. Include the details needed to complete the user's task.",
          },
          screenshot_ids: { type: "array", maxItems: 8, items: { type: "string" }, description: "Conversation image references: screenshot-1 or its numeric alias 1, or latest. For example, compare images 1, 3 and a newly attached image 4 using [\"1\", \"3\", \"4\"]. Numbers are scoped to the current conversation." },
          paths: { type: "array", maxItems: 8, items: { type: "string" }, description: "Workspace-relative image paths; never secrets or files outside the workspace." },
          image_ids: {
            type: "array",
            items: { type: "string" },
            description: "Attachment IDs listed in the current user message. Omit or pass an empty array to inspect all attached images.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  metadata: { dangerLevel: "safe", requiresConfirmation: false, scope: "global" },
  handler: async (args, context) => {
    if (!context?.analyzeImages) {return "Error: no images are available to analyze in this generation.";}
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const imageIds = Array.isArray(args.image_ids)
      ? args.image_ids.filter((value): value is string => typeof value === "string")
      : [];
    if (!question) {return "Error: question is required.";}
        for (const key of ["image_ids", "screenshot_ids", "paths"]) {
      if (args[key] !== undefined && (!Array.isArray(args[key]) || (args[key] as unknown[]).length > 8 || !(args[key] as unknown[]).every((value) => typeof value === "string" && value.length > 0 && value.length <= 2048))) {
        return `Error: invalid ${key}.`;
      }
    }
    return context.analyzeImages({ question, attachmentIds: imageIds,
      screenshotIds: args.screenshot_ids as string[] | undefined,
      paths: args.paths as string[] | undefined }, context.signal);
  },
};

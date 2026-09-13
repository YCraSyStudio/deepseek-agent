import type { RegisteredTool } from "@/application/tools/Types";

export const analyzeImagesTool: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "analyze_images",
      description: "Inspect one or more images attached to the current user message using DeepSeek V4.1 Flash. Call this before answering any question that depends on visual details, because the current model cannot read images itself. The result is a text description for the current model.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The precise visual question to answer. Include the details needed to complete the user's task.",
          },
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
    return context.analyzeImages(question, imageIds, context.signal);
  },
};

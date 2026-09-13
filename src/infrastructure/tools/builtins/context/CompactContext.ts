import type { ToolDefinition } from "@/contracts";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";

async function handleCompactContext(): Promise<string> {
  return [
    "Context compaction requested. The active tool protocol will be rolled over into a compacted continuation for the next round.",
    "Treat the next request as continuity state: trust successful tool outcomes and do not repeat completed mutations.",
  ].join(" ");
}

export const compactContextDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "compact_context",
    description:
      "Compact the active tool-cycle context and continue from a summarized continuation. Use this when the conversation has grown large enough that continuing would risk exceeding the context limit. After calling it, trust prior successful tool results and do not repeat completed work.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};

export const compactContextHandler: RegisteredTool["handler"] = handleCompactContext;

export const compactContextMetadata: ToolMetadata = {
  dangerLevel: "safe",
  requiresConfirmation: false,
  scope: "global",
  effect: "read-only",
};

import type { RegisteredTool } from "@/application/tools/Types";
import type { CodeCompletionRequest } from "@/contracts/CodeCompletion";

export const completeCodeTool: RegisteredTool = {
  definition: { type: "function", function: {
    name: "complete_code",
    description: "Beta code generation without modifying files. Use fim to fill the gap between a code prefix and optional suffix; its result is only the missing middle. Use prefix to continue an assistant prefix such as a code fence, with an instruction describing the task. The result preserves the API response text; inspect it before applying through normal edit tools and do not duplicate existing prefix/suffix text. reasoning_prefix is only for prefix mode with thinking enabled. The separate completion request is included in usage. Beta features must be enabled in Settings.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["prefix", "fim"] },
        prefix: { type: "string", maxLength: 65536 },
        suffix: { type: "string", maxLength: 65536, description: "Code following the gap, only for fim mode." },
        instruction: { type: "string", maxLength: 16000, description: "The task to perform, only for prefix mode." },
        reasoning_prefix: { type: "string", maxLength: 8192, description: "Optional caller-supplied reasoning prefix, only for prefix mode with thinking enabled." },
        max_tokens: { type: "integer", minimum: 1, maximum: 4096 },
        stop: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1024 } },
      },
      required: ["mode", "prefix"], additionalProperties: false,
    },
  } },
  metadata: { dangerLevel: "safe", requiresConfirmation: true, scope: "global", effect: "external-effect" },
  handler: async (args, context) => {
    if (!context?.completeCode) {throw new Error("DeepSeek beta code completion is disabled or unavailable.");}
    if (args.mode !== "prefix" && args.mode !== "fim") {throw new Error("mode must be prefix or fim.");}
    for (const [key, limit] of [["prefix", 65536], ["suffix", 65536], ["instruction", 16000], ["reasoning_prefix", 8192]] as const) {
      if (args[key] !== undefined && (typeof args[key] !== "string" || (args[key] as string).length > limit)) {throw new Error(`Invalid ${key}.`);}
    }
    if (typeof args.prefix !== "string" || !args.prefix.length) {throw new Error("A non-empty prefix is required.");}
    if (args.mode === "fim" && (args.instruction || args.reasoning_prefix)) {throw new Error("FIM accepts code prefix and suffix, not chat instructions or reasoning.");}
    if (args.mode === "prefix" && args.suffix) {throw new Error("A suffix is only supported by FIM.");}
    if (args.max_tokens !== undefined && (!Number.isInteger(args.max_tokens) || Number(args.max_tokens) < 1 || Number(args.max_tokens) > 4096)) {throw new Error("max_tokens must be between 1 and 4096.");}
    if (args.stop !== undefined && (!Array.isArray(args.stop) || args.stop.length > 16 || !args.stop.every((item) => typeof item === "string" && item.length > 0 && item.length <= 1024))) {throw new Error("Invalid stop sequences.");}
    const request: CodeCompletionRequest = {
      mode: args.mode, prefix: args.prefix, suffix: args.suffix as string | undefined,
      instruction: args.instruction as string | undefined, reasoningPrefix: args.reasoning_prefix as string | undefined,
      maxTokens: args.max_tokens as number | undefined, stop: args.stop as string[] | undefined,
    };
    return context.completeCode(request, context.signal);
  },
};

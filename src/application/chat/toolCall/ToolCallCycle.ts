import { createSystemMessage, ensureSingleSystemPrompt } from "@/contracts/deepseek/Chat";
import type { ChatMessage } from "@/contracts";
import { createToolResultMessage, validateToolCall } from "./ToolCallMessages";
import type {
  RunToolCallCycleOptions,
  ToolCallCycleOptions,
  ToolCallCycleResult,
} from "./ToolCallTypes";
import { createCompletionRecoveryMessage, createProgressReviewCheckpointMessage } from "./TurnGuidance";
import { fitToolResultForModel } from "./ToolResultFit";
import { logWarning } from "@/shared/logging/Logger";
import { redactToolOutput } from "@/shared/security/ToolOutputRedaction";

const DEFAULT_PROGRESS_REVIEW_INTERVAL = 20;
const DEFAULT_PROGRESS_REVIEW_FOLLOW_UP_INTERVAL = 5;

export async function runToolCallCycle(options: RunToolCallCycleOptions): Promise<ToolCallCycleResult> {
  const { initialMessages, tools, model, modelClient, executeToolCall, cycleOptions = {} } = options;

  let messages = ensureSingleSystemPrompt(initialMessages, createSystemMessage);
  const transcript: ChatMessage[] = [];
  let toolCallsExecuted = 0;
  let completionRecoveryUsed = false;
  let progressReviewsCompleted = 0;
  const executedSignatures = new Map<string, number>();
  let mutationEpoch = 0;
  const seenProviderToolCallIds = new Set<string>();

  for (let round = 0; ; round++) {
    if (cycleOptions.signal?.aborted) {
      throw createAbortError();
    }

    const reasoningTools = await cycleOptions.getToolsForRound?.("reasoning", round + 1) ?? tools;
    messages = await prepareRequestContext(messages, reasoningTools, round + 1, cycleOptions);
    cycleOptions.validateRequestBudget?.(messages, reasoningTools);
    cycleOptions.budgetManager?.resetOutput();
    const shouldStream = cycleOptions.streamFinalResponse === true;
    let response;
    if (shouldStream) {
      response = await modelClient.streamRound({ messages, tools: reasoningTools, model, cycleOptions, emitStreamEvents: true });
    } else {
      response = await modelClient.completeRound({ messages, tools: reasoningTools, model, cycleOptions });
    }
    const message = response.choices[0].message;
    const finishReason = response.choices[0].finish_reason;
    if (message.tool_calls?.length && finishReason !== "tool_calls") {
      throw new Error(
        finishReason === "length"
          ? "DeepSeek reached its output limit before completing a tool call. No truncated tool was executed."
          : `DeepSeek ended with ${String(finishReason)} before completing its tool-call protocol. No tool was executed.`,
      );
    }
    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (finishReason === "stop" && cycleOptions.reviewCompletion) {
        const decision = await cycleOptions.reviewCompletion({
          messages: structuredClone(messages),
          candidate: structuredClone(message),
          toolCallsExecuted,
          recoveryAttempted: completionRecoveryUsed,
        });
        if (decision === "incomplete") {
          if (!completionRecoveryUsed) {
            completionRecoveryUsed = true;
            messages.push(createCompletionRecoveryMessage());
            cycleOptions.onStreamChunk?.("\n\n");
            continue;
          }
          logWarning("[ToolCallCycle] Completion review still reported an incomplete answer after recovery; keeping the delivered response.");
        }
      }
      transcript.push(structuredClone(message));
      cycleOptions.onTranscriptUpdate?.(structuredClone(transcript), "complete");
      return {
        finalMessage: message,
        rounds: round + 1,
        toolCallsExecuted,
        response,
        transcript,
      };
    }

    assertUniqueToolCallIds(message.tool_calls, seenProviderToolCallIds);
    for (const toolCall of message.tool_calls) {seenProviderToolCallIds.add(toolCall.id);}
    assertValidToolArguments(message);
    const toolRoundTools = await cycleOptions.getToolsForRound?.("tools", round + 1) ?? reasoningTools;
    const availableTools = new Map(toolRoundTools.map((tool) => [tool.function.name, tool]));
    const executableToolCalls = message.tool_calls.filter(
      (toolCall) => validateToolCall(toolCall, availableTools).valid &&
        executedSignatures.get(createToolSignature(toolCall)) !== mutationEpoch,
    );
    if (executableToolCalls.length > 0) {
      await cycleOptions.onRoundStart?.(round + 1, executableToolCalls);
    }
    messages.push(message);
    transcript.push(structuredClone(message));
    cycleOptions.onTranscriptUpdate?.(structuredClone(transcript), "incomplete");

    for (const toolCall of message.tool_calls) {
      if (cycleOptions.signal?.aborted) {
        throw createAbortError();
      }

      const validation = validateToolCall(toolCall, availableTools);
      if (!validation.valid) {
        const invalidResult = createToolResultMessage(toolCall.id, toolCall.function.name, fitToolResultForModel(`Error: ${validation.error}`));
        messages.push(invalidResult);
        transcript.push(structuredClone(invalidResult));
        cycleOptions.onTranscriptUpdate?.(structuredClone(transcript), "incomplete");
        continue;
      }

      const signature = createToolSignature(toolCall);
      if (executedSignatures.get(signature) === mutationEpoch) {
        const duplicateResult = createToolResultMessage(toolCall.id, toolCall.function.name, fitToolResultForModel("Skipped: identical tool call already executed in this cycle."));
        messages.push(duplicateResult);
        transcript.push(structuredClone(duplicateResult));
        cycleOptions.onTranscriptUpdate?.(structuredClone(transcript), "incomplete");
        continue;
      }
      const result = redactToolOutput(await executeToolCall(toolCall));
      toolCallsExecuted++;
      if (shouldRememberToolSignature(toolCall, result)) {
        if (invalidatesPriorToolSignatures(toolCall)) {mutationEpoch++;}
        executedSignatures.set(signature, mutationEpoch);
      }
      cycleOptions.onToolResult?.(toolCall.id, result);
      const toolResult = createToolResultMessage(toolCall.id, toolCall.function.name, fitToolResultForModel(result));
      messages.push(toolResult);
      transcript.push(structuredClone(toolResult));
      cycleOptions.onTranscriptUpdate?.(structuredClone(transcript), "incomplete");
    }

    const completedRounds = round + 1;
    const progressReviewInterval = normalizeProgressReviewInterval(cycleOptions.progressReviewInterval);
    if (
      cycleOptions.reviewProgress &&
      shouldReviewProgress(completedRounds, progressReviewInterval)
    ) {
      const review = await cycleOptions.reviewProgress({
        messages: structuredClone(messages),
        completedRounds,
        toolCallsExecuted,
        reviewsCompleted: progressReviewsCompleted,
      });
      progressReviewsCompleted++;

      if (review.decision !== "unknown") {
        messages.push(createProgressReviewCheckpointMessage(review, completedRounds));
      }
    }
  }
}

function assertValidToolArguments(message: ChatMessage): void {
  for (const toolCall of message.tool_calls ?? []) {
    try {
      JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error(`DeepSeek returned invalid JSON arguments for tool "${toolCall.function.name}".`);
    }
  }
}

async function prepareRequestContext(
  messages: ChatMessage[],
  tools: Parameters<NonNullable<ToolCallCycleOptions["prepareRequestContext"]>>[1],
  round: number,
  cycleOptions: ToolCallCycleOptions,
): Promise<ChatMessage[]> {
  const replacement = await cycleOptions.prepareRequestContext?.(messages, tools, round);
  return replacement ? ensureSingleSystemPrompt(replacement, createSystemMessage) : messages;
}

function assertUniqueToolCallIds(
  toolCalls: readonly { id: string }[],
  previouslySeen: ReadonlySet<string>,
): void {
  const current = new Set<string>();
  for (const toolCall of toolCalls) {
    if (!toolCall.id || current.has(toolCall.id) || previouslySeen.has(toolCall.id)) {
      throw new Error(`DeepSeek returned a duplicate or empty tool-call ID: "${toolCall.id}".`);
    }
    current.add(toolCall.id);
  }
}

function normalizeProgressReviewInterval(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.trunc(value as number)
    : DEFAULT_PROGRESS_REVIEW_INTERVAL;
}

function shouldReviewProgress(completedRounds: number, initialInterval: number): boolean {
  if (completedRounds === initialInterval) {return true;}
  if (completedRounds < initialInterval) {return false;}
  const followUpInterval = initialInterval === DEFAULT_PROGRESS_REVIEW_INTERVAL
    ? DEFAULT_PROGRESS_REVIEW_FOLLOW_UP_INTERVAL
    : initialInterval;
  return (completedRounds - initialInterval) % followUpInterval === 0;
}

function createToolSignature(toolCall: { function: { name: string; arguments: string } }): string {
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    if (toolCall.function.name === "edit_file") {
      if (typeof args.search === "string") {args.search = normalizeSignatureLineEndings(args.search);}
      if (typeof args.replace === "string") {args.replace = normalizeSignatureLineEndings(args.replace);}
    }
    if (toolCall.function.name === "apply_patch" && typeof args.diff === "string") {
      args.diff = normalizeSignatureLineEndings(args.diff);
    }
    return `${toolCall.function.name}\u0000${stableStringify(args)}`;
  } catch {
    return `${toolCall.function.name}\u0000${toolCall.function.arguments.trim()}`;
  }
}

function normalizeSignatureLineEndings(value: string): string {return value.replace(/\r\n|\r/g, "\n");}

function shouldRememberToolSignature(toolCall: { function: { name: string } }, result: string): boolean {
  if (toolCall.function.name === "read_file") {return false;}
  return !/^\s*(?:Error\b|Skipped:)/i.test(result);
}

function invalidatesPriorToolSignatures(toolCall: { function: { name: string } }): boolean {
  return ["create_file", "edit_file", "apply_patch", "move_path", "delete_path", "run_terminal_command"].includes(toolCall.function.name);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {return `[${value.map(stableStringify).join(",")}]`;}
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createAbortError(): Error {
  const error = new Error("Tool call cycle aborted");
  error.name = "AbortError";
  return error;
}

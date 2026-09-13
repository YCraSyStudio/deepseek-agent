import { createProviderTranscript } from "@/application/chat/ProviderTranscript";
import { getTextContent } from "@/contracts/deepseek/Chat";
import { redactSensitiveText } from "@/shared/security/Redaction";
import { isCancellationError } from "@/shared/utils/Cancellation";
import type { HandleRunErrorOptions, PostFinalMessageOptions, StoredExecution, ToolCallRunResult } from "./Types";

export function postFinalToolCallMessage({
  options,
  stream,
  result,
  executedToolCalls,
  streamedContent,
}: PostFinalMessageOptions): ToolCallRunResult {
  const toolCallResults = Array.from(executedToolCalls.values());
  const timeline = stream.getTimeline();
  const hasStreamedContent = timeline.length > 0;

  if (getTextContent(result.finalMessage.content) || toolCallResults.length > 0) {
    options.eventSink.publish({
      type: "addMessage",
      message: {
        role: "assistant",
        content: hasStreamedContent ? "" : getTextContent(result.finalMessage.content),
        wasStreamed: hasStreamedContent,
        toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
        timeline,
      },
    });
  }

  const finishReason = result.response.choices[0]?.finish_reason;
  const complete = finishReason === "stop";
  stream.done({ finish_reason: finishReason ?? undefined });

  return {
    content: hasStreamedContent ? streamedContent : getTextContent(result.finalMessage.content),
    timeline,
    toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
    partial: !complete,
    providerTranscript: createProviderTranscript(result.transcript, complete ? "complete" : "incomplete", finishReason),
  };
}

export function handleToolCallRunError({
  err,
  options,
  stream,
  executedToolCalls,
  streamedContent,
}: HandleRunErrorOptions): ToolCallRunResult | undefined {
  if (isCancellationError(err, options.signal)) {
    markUnfinishedExecutions(executedToolCalls, "cancelled", "Cancelled with the active generation.", options);
    const partialToolCalls = Array.from(executedToolCalls.values());
    const timeline = stream.getTimeline();
    const hasPartial = timeline.length > 0 || partialToolCalls.length > 0;

    if (!options.isCancelling()) {
      if (partialToolCalls.length > 0) {
        options.eventSink.publish({
          type: "addMessage",
          message: {
            role: "assistant",
            content: streamedContent || "",
            wasStreamed: timeline.length > 0,
            toolCalls: partialToolCalls,
            timeline,
          },
        });
      }
      stream.done({ status: "interrupted" });
    }

    return hasPartial
      ? {
          content: streamedContent,
          timeline,
          toolCalls: partialToolCalls.length > 0 ? partialToolCalls : undefined,
          partial: true,
        }
      : undefined;
  }

  markUnfinishedExecutions(
    executedToolCalls,
    "error",
    "Tool execution ended because the generation failed.",
    options,
  );
  const partialToolCalls = Array.from(executedToolCalls.values());
  const timeline = stream.getTimeline();
  if (partialToolCalls.length > 0) {
    options.eventSink.publish({
      type: "addMessage",
      message: {
        role: "assistant",
        content: streamedContent,
        wasStreamed: timeline.length > 0,
        toolCalls: partialToolCalls,
        timeline,
      },
    });
  }
  stream.error(`Error en tool calls: ${redactSensitiveText(err)}`);
  return partialToolCalls.length > 0 || timeline.length > 0
    ? {
        content: streamedContent,
        timeline,
        toolCalls: partialToolCalls.length > 0 ? partialToolCalls : undefined,
        partial: true,
      }
    : undefined;
}

function markUnfinishedExecutions(
  executions: Map<string, StoredExecution>,
  status: "cancelled" | "error",
  fallbackResult: string,
  options: HandleRunErrorOptions["options"],
): void {
  for (const execution of executions.values()) {
    if (execution.status !== "pending" && execution.status !== "awaiting_confirmation" && execution.status !== "running") {
      continue;
    }
    execution.status = status;
    execution.isError = status === "error";
    execution.requiresConfirmation = false;
    execution.result ??= fallbackResult;
    void options.eventSink.publish({
      type: "toolCallResult",
      toolCallId: execution.toolCallId,
      toolName: execution.toolName,
      result: execution.result,
      isError: execution.isError,
      status,
    });
  }
}

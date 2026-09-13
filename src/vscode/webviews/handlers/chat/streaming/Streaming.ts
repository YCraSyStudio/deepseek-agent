import { mapReasoningEffort, type AppConfig, type ChatCompletionRequest, type ChatMessage, type StreamChunk } from "@/contracts";
import type { ModelProvider } from "@/application/ports";
import { createSystemMessage } from "@/contracts/deepseek/Chat";
import { PartialStreamError, type StreamedAssistantResult } from "@/application/errors/PartialStreamError";
import type { ProviderUsage } from "@/shared/usage/Usage";
import { StreamEventEmitter } from "./StreamEventEmitter";
import type { SendMessagePayload } from "../Types";
import type { GenerationEventSink } from "@/application/ports";
import { GenerationBudgetManager } from "@/application/chat/context/GenerationBudgetManager";
import { isCancellationError } from "@/shared/utils/Cancellation";
import { getErrorMessage } from "@/shared/utils/Errors";
import { appendBoundedUtf8 } from "@/shared/utils/BoundedText";

const MAX_VISIBLE_REASONING_BYTES = 512 * 1024;

interface SendMessageStreamingOptions {
  messages: ChatMessage[];
  payload: SendMessagePayload;
  config: AppConfig;
  provider: ModelProvider;
  eventSink: GenerationEventSink<Record<string, unknown>>;
  signal: AbortSignal;
  onUsage?: (usage?: ProviderUsage) => void;
  budgetManager?: GenerationBudgetManager;
}

export async function sendMessageStreaming({ messages, payload, config, provider, eventSink, signal, onUsage, budgetManager }: SendMessageStreamingOptions): Promise<StreamedAssistantResult> {
  const activeBudgetManager = budgetManager ?? new GenerationBudgetManager(payload.modelId || config.model, config.maxTokens);
  return streamAttempt({
    messages,
    payload,
    config,
    provider,
    eventSink,
    signal,
    onUsage,
    budgetManager: activeBudgetManager,
    conciseRecovery: false,
  });
}

async function streamAttempt(options: SendMessageStreamingOptions & { conciseRecovery: boolean }): Promise<StreamedAssistantResult> {
  const { messages, payload, config, provider, eventSink, signal, onUsage, conciseRecovery } = options;
  const budgetManager = options.budgetManager ?? new GenerationBudgetManager(payload.modelId || config.model, config.maxTokens);
  const hasSystemPrompt = messages.length > 0 && messages[0].role === "system";
  const requestMessages = conciseRecovery ? withConciseRecoveryInstruction(messages) : messages;
  const request: ChatCompletionRequest = {
    model: payload.modelId || config.model,
    messages: hasSystemPrompt ? requestMessages : [createSystemMessage(), ...requestMessages],
    stream: true,
    thinking: conciseRecovery || payload.reasoning === "off" ? { type: "disabled" } : { type: "enabled" },
    reasoning_effort: conciseRecovery ? undefined : mapReasoningEffort(payload.reasoning),
    max_tokens: budgetManager.effectiveMaxTokens,
  };

  const result: StreamedAssistantResult = { content: "", reasoning: "", timeline: [] };
  const stream = new StreamEventEmitter(eventSink);
  let finishReason: string | null | undefined;
  let stoppedForExcessiveReasoning = false;
  const internalController = new AbortController();
  const combinedSignal = AbortSignal.any([signal, internalController.signal]);

  try {
    await provider.chatCompletionStream(
      request,
      (chunk: StreamChunk) => {
        if (chunk.type === "usage") {
          if (chunk.usage) {
            result.usage = chunk.usage;
          }
          return;
        }
        if (chunk.type === "done") {
          finishReason = chunk.finish_reason;
          return;
        }
        if (chunk.type === "content") {
          result.content += chunk.content ?? "";
        } else if (chunk.type === "reasoning") {
          result.reasoning = appendBoundedUtf8(
            result.reasoning,
            chunk.reasoning_content ?? "",
            MAX_VISIBLE_REASONING_BYTES,
          );
        }
        stream.fromChunk(chunk);
        if (chunk.type === "content" || chunk.type === "reasoning") {
          const assessment = budgetManager.observeOutput(chunk.reasoning_content, chunk.content);
          if (
            assessment.status === "output_reasoning_limit" &&
            !conciseRecovery &&
            budgetManager.canRecoverConcise()
          ) {
            stoppedForExcessiveReasoning = true;
            internalController.abort();
          }
        }
      },
      combinedSignal,
    );
  } catch (err: unknown) {
    result.timeline = stream.getTimeline();
    if (stoppedForExcessiveReasoning && !signal.aborted) {
      budgetManager.recordConciseRecovery();
      await eventSink.publish({
        type: "generationRecoveryStarted",
        reason: "excessive_reasoning",
        message: "The previous attempt was reasoning more than necessary. Retrying once with a concise response.",
      });
      return streamAttempt({ ...options, conciseRecovery: true });
    }
    if (result.content || result.reasoning) {
      throw new PartialStreamError(
        isCancellationError(err, signal) ? "Stream cancelled with partial content" : `Stream failed after partial content: ${getErrorMessage(err)}`,
        result,
        isCancellationError(err, signal) ? "cancelled" : "failed",
      );
    }
    throw err;
  } finally {
    budgetManager.recordPromptUsage(request.messages, [], result.usage);
    budgetManager.recordRequestContext(request.messages, [], result.usage);
    onUsage?.(result.usage);
  }

  result.timeline = stream.getTimeline();
  if (finishReason !== "stop") {
    const message = describeIncompleteFinish(finishReason);
    if (result.content || result.reasoning) {throw new PartialStreamError(message, result, "failed");}
    throw new Error(message);
  }
  stream.done({ finish_reason: finishReason });
  return result;
}

function withConciseRecoveryInstruction(messages: ChatMessage[]): ChatMessage[] {
  const instruction = "The previous attempt approached its output budget while reasoning. Reasoning further is unnecessary. Trust successful results already present, avoid additional verification, and provide the required answer or single essential tool call concisely.";
  return messages.map((message, index) => index === 0 && message.role === "system"
    ? { ...message, content: `${message.content ?? ""}\n\n<concise_recovery>${instruction}</concise_recovery>` }
    : message);
}

function describeIncompleteFinish(reason: string | null | undefined): string {
  switch (reason) {
    case "length": return "DeepSeek stopped because the output limit was reached. The response was saved as incomplete.";
    case "content_filter": return "DeepSeek stopped because content was filtered. The response was saved as incomplete.";
    case "insufficient_system_resource": return "DeepSeek stopped because provider resources were insufficient. The response was saved as incomplete.";
    case undefined:
    case null: return "DeepSeek ended without a terminal finish reason. The response was saved as incomplete.";
    default: return `DeepSeek ended with unsupported finish reason "${reason}". The response was saved as incomplete.`;
  }
}


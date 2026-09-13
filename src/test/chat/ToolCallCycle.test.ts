import * as assert from "assert";
import type { ChatCompletionResponse, ChatMessage } from "@/contracts";
import { runToolCallCycle } from "@/application/chat/toolCall/ToolCallCycle";

suite("tool call cycle completion", () => {
  test("continues across tool rounds until the model returns a final response", async () => {
    const responses = [toolResponse("call-1", "README.md"), toolResponse("call-2", "CHANGELOG.md"), finalResponse];
    let executed = 0;

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "read both files" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => responses.shift()!,
        streamRound: async () => responses.shift()!,
      },
      executeToolCall: async () => {
        executed++;
        return "contents";
      },
    });

    assert.strictEqual(result.toolCallsExecuted, 2);
    assert.strictEqual(executed, 2);
    assert.strictEqual(result.rounds, 3);
  });

  test("injects reviewer guidance and continues after a soft checkpoint", async () => {
    const responses = [toolResponse("call-1", "README.md"), finalResponse];
    const requests: ChatMessage[][] = [];
    const reviewContexts: Array<{ completedRounds: number; toolCallsExecuted: number }> = [];

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "finish the task" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async ({ messages }) => {
          requests.push(messages);
          return responses.shift()!;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "created",
      cycleOptions: {
        progressReviewInterval: 1,
        reviewProgress: async (context) => {
          reviewContexts.push(context);
          return {
            decision: "continue",
            confidence: "high",
            reason: "One focused check remains.",
            nextAction: "Run only the final check.",
          };
        },
      },
    });

    assert.deepStrictEqual(reviewContexts.map(({ completedRounds, toolCallsExecuted }) => ({ completedRounds, toolCallsExecuted })), [
      { completedRounds: 1, toolCallsExecuted: 1 },
    ]);
    assert.match(String(requests[1].at(-1)?.content), /progress_review_checkpoint/);
    assert.match(String(requests[1].at(-1)?.content), /Run only the final check/);
    assert.strictEqual(result.rounds, 2);
  });

  test("reviews progress after the default block of twenty completed tool rounds", async () => {
    let providerRequests = 0;
    let progressReviews = 0;

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "complete a long task" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => {
          providerRequests++;
          return providerRequests <= 20
            ? toolResponse(`call-${providerRequests}`, `file-${providerRequests}.md`)
            : finalResponse;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "completed",
      cycleOptions: {
        reviewProgress: async (context) => {
          progressReviews++;
          assert.strictEqual(context.completedRounds, 20);
          return {
            decision: "continue",
            confidence: "high",
            reason: "One final response remains.",
          };
        },
      },
    });

    assert.strictEqual(progressReviews, 1);
    assert.strictEqual(result.toolCallsExecuted, 20);
    assert.strictEqual(result.rounds, 21);
  });

  test("reviews every five rounds after crossing the default soft limit", async () => {
    let providerRequests = 0;
    const reviewedRounds: number[] = [];

    await runToolCallCycle({
      initialMessages: [{ role: "user", content: "complete a long task" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => {
          providerRequests++;
          return providerRequests <= 25
            ? toolResponse(`call-${providerRequests}`, `file-${providerRequests}.md`)
            : finalResponse;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "completed",
      cycleOptions: {
        reviewProgress: async (context) => {
          reviewedRounds.push(context.completedRounds);
          return { decision: "continue", confidence: "high", reason: "A primary deliverable remains." };
        },
      },
    });

    assert.deepStrictEqual(reviewedRounds, [20, 25]);
  });

  test("skips an immediately repeated mutating tool call", async () => {
    const responses = [
      terminalResponse("call-1", "dotnet build"),
      terminalResponse("call-2", "dotnet build"),
      finalResponse,
    ];
    let executions = 0;

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "build once" }],
      tools: [terminalToolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => responses.shift()!,
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => {
        executions++;
        return "completed";
      },
    });

    assert.strictEqual(executions, 1);
    assert.strictEqual(result.toolCallsExecuted, 1);
    assert.ok(result.transcript.some((message) =>
      message.role === "tool" && String(message.content).includes("Skipped: identical tool call")));
  });

  test("allows the same build again after an intervening mutation", async () => {
    const responses = [
      terminalResponse("call-1", "dotnet build"),
      terminalResponse("call-2", "dotnet add package Example"),
      terminalResponse("call-3", "dotnet build"),
      finalResponse,
    ];
    const commands: string[] = [];

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "update and build" }],
      tools: [terminalToolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => responses.shift()!,
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async (toolCall) => {
        commands.push((JSON.parse(toolCall.function.arguments) as { command: string }).command);
        return "completed";
      },
    });

    assert.deepStrictEqual(commands, ["dotnet build", "dotnet add package Example", "dotnet build"]);
    assert.strictEqual(result.toolCallsExecuted, 3);
  });

  test("keeps tools available after a high-confidence finalize recommendation", async () => {
    const responses = [toolResponse("call-1", "README.md"), finalResponse];
    const requestedToolCounts: number[] = [];

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "finish the task" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async ({ messages, tools }) => {
          requestedToolCounts.push(tools.length);
          if (requestedToolCounts.length === 2) {
            assert.match(String(messages.at(-1)?.content), /progress_review_checkpoint/);
            assert.match(String(messages.at(-1)?.content), /Stop using tools now/);
          }
          return responses.shift()!;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "created",
      cycleOptions: {
        progressReviewInterval: 1,
        reviewProgress: async () => ({
          decision: "finalize",
          confidence: "high",
          reason: "The requested result is complete.",
        }),
      },
    });

    assert.deepStrictEqual(requestedToolCounts, [1, 1]);
    assert.strictEqual(result.toolCallsExecuted, 1);
    assert.strictEqual(result.finalMessage.content, "done");
    assert.strictEqual(result.rounds, 2);
  });

  test("does not auto-finalize an uncertain progress review", async () => {
    const responses = [toolResponse("call-1", "README.md"), finalResponse];
    const requestedToolCounts: number[] = [];

    await runToolCallCycle({
      initialMessages: [{ role: "user", content: "finish the task" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async ({ tools }) => {
          requestedToolCounts.push(tools.length);
          return responses.shift()!;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "created",
      cycleOptions: {
        progressReviewInterval: 1,
        reviewProgress: async () => ({
          decision: "finalize",
          confidence: "medium",
          reason: "The evidence may be sufficient.",
        }),
      },
    });

    assert.deepStrictEqual(requestedToolCounts, [1, 1]);
  });

  test("never executes tool fragments from a length-truncated response", async () => {
    let executed = false;
    await assert.rejects(runToolCallCycle({
      initialMessages: [{ role: "user", content: "read" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => truncatedToolResponse,
        streamRound: async () => truncatedToolResponse,
      },
      executeToolCall: async () => {
        executed = true;
        return "should not run";
      },
    }), /output limit.*No truncated tool was executed/);
    assert.strictEqual(executed, false);
  });

  test("retries once when a stopped response only announces a future action", async () => {
    const responses = [stalledResponse, finalResponse];
    const completionReviews: Array<"complete" | "incomplete" | "unknown"> = ["incomplete", "complete"];
    const requests: ChatMessage[][] = [];
    const streamed: string[] = [];

    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "busca la versión absoluta" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async ({ messages }) => {
          requests.push(messages);
          return responses.shift()!;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "unused",
      cycleOptions: {
        onStreamChunk: (content) => streamed.push(content),
        reviewCompletion: async () => completionReviews.shift() ?? "unknown",
      },
    });

    assert.strictEqual(requests.length, 2);
    assert.match(String(requests[1].at(-1)?.content ?? ""), /completion_recovery/);
    assert.deepStrictEqual(streamed, ["\n\n"]);
    assert.strictEqual(result.finalMessage.content, "done");
    assert.strictEqual(result.rounds, 2);
  });

  test("keeps the delivered answer when recovery also stops prematurely", async () => {
    let requests = 0;
    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "search" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => {
          requests++;
          return stalledResponse;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "unused",
      cycleOptions: { reviewCompletion: async () => "incomplete" },
    });

    assert.strictEqual(requests, 2);
    assert.strictEqual(result.rounds, 2);
    assert.strictEqual(result.finalMessage.content, stalledResponse.choices[0].message.content);
  });

  test("treats tool-shaped assistant text as ordinary content without executing or retrying", async () => {
    let requests = 0;
    let executions = 0;
    const result = await runToolCallCycle({
      initialMessages: [{ role: "user", content: "answer without tools" }],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async () => {
          requests++;
          return toolShapedAssistantResponse;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => {
        executions++;
        return "unexpected";
      },
    });

    assert.strictEqual(requests, 1);
    assert.strictEqual(executions, 0);
    assert.strictEqual(result.rounds, 1);
    assert.strictEqual(result.finalMessage.content, toolShapedAssistantResponse.choices[0].message.content);
  });

  test("appends to the serialized prefix across tool rounds instead of rewriting it", async () => {
    const responses = [toolResponse("call-1", "README.md"), toolResponse("call-2", "CHANGELOG.md"), finalResponse];
    const requests: ChatMessage[][] = [];
    const toolOrders: string[][] = [];

    await runToolCallCycle({
      initialMessages: [
        { role: "system", content: "static instructions" },
        { role: "user", content: "read both files" },
      ],
      tools: [toolDefinition, terminalToolDefinition],
      model: "model",
      modelClient: {
        completeRound: async ({ messages, tools }) => {
          requests.push(structuredClone(messages));
          toolOrders.push(tools.map((tool) => tool.function.name));
          return responses.shift()!;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "contents",
    });

    assert.strictEqual(requests.length, 3);
    for (let index = 1; index < requests.length; index += 1) {
      const previous = requests[index - 1];
      const current = requests[index];
      assert.ok(current.length > previous.length, `round ${index} replaced instead of appending messages`);
      assert.deepStrictEqual(
        current.slice(0, previous.length),
        previous,
        `round ${index} rewrote an earlier message instead of appending to it`,
      );
    }
    assert.deepStrictEqual(toolOrders, [
      ["read_file", "run_terminal_command"],
      ["read_file", "run_terminal_command"],
      ["read_file", "run_terminal_command"],
    ]);
  });

  test("appends reviewer checkpoints to the tail instead of rewriting the cached prefix", async () => {
    const responses = [toolResponse("call-1", "README.md"), toolResponse("call-2", "CHANGELOG.md"), finalResponse];
    const requests: ChatMessage[][] = [];

    await runToolCallCycle({
      initialMessages: [
        { role: "system", content: "static instructions" },
        { role: "user", content: "finish the task" },
      ],
      tools: [toolDefinition],
      model: "model",
      modelClient: {
        completeRound: async ({ messages }) => {
          requests.push(structuredClone(messages));
          return responses.shift()!;
        },
        streamRound: async () => {throw new Error("unexpected streaming round");},
      },
      executeToolCall: async () => "contents",
      cycleOptions: {
        progressReviewInterval: 1,
        reviewProgress: async () => ({
          decision: "continue",
          confidence: "high",
          reason: "One check remains.",
        }),
      },
    });

    assert.strictEqual(requests.length, 3);
    for (let index = 1; index < requests.length; index += 1) {
      assert.deepStrictEqual(
        requests[index].slice(0, requests[index - 1].length),
        requests[index - 1],
        `round ${index} rewrote an earlier message instead of appending to it`,
      );
    }
    assert.deepStrictEqual(
      requests.map((request) => request[0]?.content),
      ["static instructions", "static instructions", "static instructions"],
    );
    assert.strictEqual(requests[1].at(-1)?.role, "user");
    assert.match(String(requests[1].at(-1)?.content), /^<progress_review_checkpoint/);
    assert.match(String(requests[1].at(-1)?.content), /completed_rounds="1"/);
    assert.match(String(requests[2].at(-1)?.content), /completed_rounds="2"/);
  });
});

const toolDefinition = {
  type: "function" as const,
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};

const terminalToolDefinition = {
  type: "function" as const,
  function: {
    name: "run_terminal_command",
    description: "Run a command",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
};

const truncatedToolResponse: ChatCompletionResponse = {
  id: "response",
  object: "chat.completion",
  created: 1,
  model: "model",
  choices: [{
    index: 0,
    finish_reason: "length",
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"README.md"' },
      }],
    },
  }],
};

function toolResponse(id: string, path: string): ChatCompletionResponse {
  return {
    id: `response-${id}`,
    object: "chat.completion",
    created: 1,
    model: "model",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id,
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path }) },
        }],
      },
    }],
  };
}

function terminalResponse(id: string, command: string): ChatCompletionResponse {
  return {
    id: `response-${id}`,
    object: "chat.completion",
    created: 1,
    model: "model",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id,
          type: "function",
          function: { name: "run_terminal_command", arguments: JSON.stringify({ command }) },
        }],
      },
    }],
  };
}

const finalResponse: ChatCompletionResponse = {
  id: "response-final",
  object: "chat.completion",
  created: 1,
  model: "model",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }],
};

const stalledResponse: ChatCompletionResponse = {
  id: "response-stalled",
  object: "chat.completion",
  created: 1,
  model: "model",
  choices: [{
    index: 0,
    finish_reason: "stop",
    message: {
      role: "assistant",
      content: "I need to clarify the absolute latest version. Let me check.",
    },
  }],
};

const toolShapedAssistantResponse: ChatCompletionResponse = {
  id: "response-tool-shaped-text",
  object: "chat.completion",
  created: 1,
  model: "model",
  choices: [{
    index: 0,
    finish_reason: "stop",
    message: {
      role: "assistant",
      content: "Example text only: <tool_calls><invoke name=\"read_file\">",
    },
  }],
};

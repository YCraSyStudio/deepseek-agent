import * as assert from "assert";
import { assertUniqueToolCallIds, parseChatCompletionResponse, parseStreamToolCalls } from "@/infrastructure/deepseek/provider/features/ChatResponseValidation";

suite("DeepSeek chat response validation", () => {
  test("rejects malformed choices and tool calls", () => {
    assert.throws(
      () => parseChatCompletionResponse({ id: "x", object: "chat.completion", created: 1, model: "m", choices: [] }),
      /invalid chat completion response/,
    );
    assert.throws(
      () =>
        parseChatCompletionResponse({
          id: "x",
          object: "chat.completion",
          created: 1,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: 1 }] }, finish_reason: "tool_calls" }],
        }),
      /invalid chat completion choice/,
    );
    for (const ids of [[""], ["duplicate", "duplicate"]]) {
      assert.throws(
        () => parseChatCompletionResponse({
          id: "x",
          object: "chat.completion",
          created: 1,
          model: "m",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: ids.map((id) => ({ id, type: "function", function: { name: "read_file", arguments: "{}" } })),
            },
            finish_reason: "tool_calls",
          }],
        }),
        /invalid chat completion choice/,
      );
    }
  });

  test("normalizes valid streamed tool deltas and rejects malformed ones", () => {
    assert.deepStrictEqual(parseStreamToolCalls([{ index: 0, id: "call-1", function: { name: "read_file", arguments: "{}" } }])[0], {
      id: "call-1",
      type: "function",
      function: { name: "read_file", arguments: "{}" },
      index: 0,
    });
    assert.throws(() => parseStreamToolCalls([{ function: { arguments: 42 } }]), /invalid streamed tool arguments/);
  });

  test("rejects a provider tool-call ID reused by a later round", () => {
    assert.throws(
      () => assertUniqueToolCallIds(
        [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }],
        new Set(["call-1"]),
      ),
      /duplicate tool-call ID/,
    );
  });

  test("parses provider usage when present and stays available when missing", () => {
    const withUsage = parseChatCompletionResponse({
      id: "response-2",
      object: "chat.completion",
      created: 2,
      model: "deepseek-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        completion_tokens_details: { reasoning_tokens: 5 },
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 40,
      },
    });
    assert.deepStrictEqual(withUsage.usage, {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      reasoning_tokens: 5,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 40,
    });

    const withoutUsage = parseChatCompletionResponse({
      id: "response-3",
      object: "chat.completion",
      created: 3,
      model: "deepseek-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
    });
    assert.strictEqual(withoutUsage.usage, undefined);

    const malformedUsage = parseChatCompletionResponse({
      id: "response-4",
      object: "chat.completion",
      created: 4,
      model: "deepseek-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
    });
    assert.strictEqual(malformedUsage.usage, undefined);
  });

});

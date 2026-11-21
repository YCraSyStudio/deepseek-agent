import * as assert from "node:assert";
import type { AssistantTimelineEvent } from "@/contracts";
import {
  groupAssistantTimeline,
  summarizeActivity,
} from "@webview/components/chatView/tools/timeline/AssistantTimelineGrouping";
import type { ToolCallGroup } from "@webview/views/chatView/ChatViewTypes";

suite("assistant activity grouping", () => {
  test("groups consecutive reasoning and tools while preserving text boundaries", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "reason-1", type: "reasoning", content: "Inspect." },
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1", "call-2"] },
      { id: "reason-2", type: "reasoning", content: "Apply result." },
      { id: "content-1", type: "content", content: "Backend complete." },
      { id: "tools-2", type: "tool-group", round: 2, toolCallIds: ["call-3"] },
    ];

    const blocks = groupAssistantTimeline(timeline);

    assert.deepStrictEqual(blocks.map((block) => block.type), ["activity", "content", "activity"]);
    assert.deepStrictEqual(
      blocks[0]?.type === "activity" ? blocks[0].rounds.map((round) => round.round) : [],
      [1, 2],
    );
    assert.strictEqual(blocks[0]?.type === "activity" && flattenActivityEvents(blocks[0]).length, 3);
    assert.strictEqual(blocks[1]?.type === "content" && blocks[1].content, "Backend complete.");
  });

  test("exposes an active tool state", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "reason-1", type: "reasoning", content: "Inspect." },
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1", "call-2"] },
    ];
    const activity = groupAssistantTimeline(timeline)[0];
    assert.ok(activity?.type === "activity");
    const groups: ToolCallGroup[] = [{
      id: "round-1",
      round: 1,
      expanded: false,
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "read_file",
          arguments: "{}",
          status: "completed",
          round: 1,
        },
        {
          toolCallId: "call-2",
          toolName: "list_directory",
          arguments: "{}",
          status: "running",
          round: 1,
        },
      ],
    }];

    assert.deepStrictEqual(summarizeActivity(flattenActivityEvents(activity), groups), {
      status: "running",
    });
  });

  test("compacts intermediate output and tooling while preserving the final response", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "content-1", type: "content", content: "I will inspect the project." },
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1"] },
      { id: "content-2", type: "content", content: "I found the relevant files." },
      { id: "reason-1", type: "reasoning", content: "Summarize the result." },
      { id: "tools-2", type: "tool-group", round: 2, toolCallIds: ["call-2"] },
      { id: "content-final", type: "content", content: "## Final answer" },
    ];

    const blocks = groupAssistantTimeline(timeline, { compactCompletedCycle: true });

    assert.deepStrictEqual(blocks.map((block) => block.type), ["activity", "content"]);
    assert.deepStrictEqual(
      blocks[0]?.type === "activity"
        ? blocks[0].rounds.map((round) => ({ round: round.round, events: round.events.map((event) => event.id) }))
        : [],
      [
        { round: 1, events: ["content-1", "tools-1"] },
        { round: 2, events: ["content-2", "reason-1", "tools-2"] },
      ],
    );
    assert.strictEqual(blocks[1]?.type === "content" && blocks[1].content, "## Final answer");
  });

  test("moves a process preamble before a markdown answer into a final activity round", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "content-1", type: "content", content: "I will inspect the project." },
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1"] },
      {
        id: "content-final",
        type: "content",
        content: "The files confirm the architecture. I now have everything I need to summarize it.\n\n## Project summary\n\nStable result.",
      },
    ];

    const blocks = groupAssistantTimeline(timeline, { compactCompletedCycle: true });
    const activity = blocks[0];

    assert.ok(activity?.type === "activity");
    assert.deepStrictEqual(activity.rounds.map((round) => round.round), [1, 2]);
    assert.strictEqual(activity.rounds[1]?.events[0]?.type === "content" && activity.rounds[1].events[0].content,
      "The files confirm the architecture. I now have everything I need to summarize it.");
    assert.strictEqual(blocks[1]?.type === "content" && blocks[1].content,
      "## Project summary\n\nStable result.");
  });

  test("keeps an answer without reasoning or tools outside the activity panel", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "content-final", type: "content", content: "Direct answer." },
    ];

    assert.deepStrictEqual(
      groupAssistantTimeline(timeline, { compactCompletedCycle: true }),
      timeline,
    );
  });

  test("uses the latest completed state after an earlier recovered failure", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1"] },
      { id: "tools-2", type: "tool-group", round: 2, toolCallIds: ["call-2"] },
    ];
    const activity = groupAssistantTimeline(timeline)[0];
    assert.ok(activity?.type === "activity");
    const groups: ToolCallGroup[] = [
      createGroup(1, "call-1", "error"),
      createGroup(2, "call-2", "completed"),
    ];

    assert.strictEqual(summarizeActivity(flattenActivityEvents(activity), groups).status, "completed");
  });

  test("uses the recovery fallback when a restored timeline has no tool snapshot", () => {
    const timeline: AssistantTimelineEvent[] = [
      { id: "tools-1", type: "tool-group", round: 1, toolCallIds: ["call-1"] },
    ];
    const activity = groupAssistantTimeline(timeline)[0];
    assert.ok(activity?.type === "activity");

    assert.strictEqual(summarizeActivity(flattenActivityEvents(activity), [], "cancelled").status, "cancelled");
  });
});

function flattenActivityEvents(
  activity: Extract<ReturnType<typeof groupAssistantTimeline>[number], { type: "activity" }>,
): AssistantTimelineEvent[] {
  return activity.rounds.flatMap((round) => round.events);
}

function createGroup(
  round: number,
  toolCallId: string,
  status: "completed" | "error",
): ToolCallGroup {
  return {
    id: `round-${round}`,
    round,
    expanded: false,
    toolCalls: [{
      toolCallId,
      toolName: "read_file",
      arguments: "{}",
      status,
      round,
    }],
  };
}

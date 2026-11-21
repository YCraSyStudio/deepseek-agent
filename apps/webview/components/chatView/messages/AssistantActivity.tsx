import type React from "react";
import type { AssistantTimelineEvent } from "@/contracts";
import type {
  ChatMessage,
  ToolCallGroup,
  ToolCallStatus,
} from "@webview/views/chatView/ChatViewTypes";
import { t } from "@webview/i18n";
import {
  groupAssistantTimeline,
  summarizeActivity,
  type AssistantActivityRound,
  type AssistantTimelineBlock,
} from "../tools/timeline/AssistantTimelineGrouping";
import { MarkdownMessage } from "./MarkdownMessage";
import { useAutoCollapsePanel } from "./UseAutoCollapsePanel";

export function AssistantActivity({
  timeline,
  toolCallGroups,
  renderToolCallGroups,
  isActive = false,
  generationStatus,
  generationStopReason,
}: {
  timeline: AssistantTimelineEvent[];
  toolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  isActive?: boolean;
  generationStatus?: ChatMessage["generationStatus"];
  generationStopReason?: ChatMessage["generationStopReason"];
}) {
  const compactCompletedCycle = generationStatus === "completed" || (!isActive && generationStatus === undefined);
  const blocks = groupAssistantTimeline(timeline, { compactCompletedCycle });
  return (
    <div className="chronologicalAssistant">
      {blocks.map((block, index) =>
        block.type === "activity" ? (
          <ActivityPanel
            key={block.id}
            block={block}
            toolCallGroups={toolCallGroups}
            renderToolCallGroups={renderToolCallGroups}
            missingToolStatus={getMissingToolStatus(blocks, index, isActive, generationStatus)}
            isLive={isActive && index === blocks.length - 1}
          />
        ) : (
          <MarkdownMessage key={block.id} content={block.content} role="assistant" />
        ),
      )}
      {(generationStatus === "cancelled" || generationStatus === "interrupted") && generationStopReason !== "steered" ? (
        <div className={`generationTerminalStatus ${generationStatus}`} role="status">
          <span className={`codicon codicon-${generationStatus === "cancelled" ? "debug-stop" : "warning"}`} aria-hidden="true" />
          {t(generationStatus === "cancelled" ? "chat.responseCancelled" : "chat.responseInterrupted")}
        </div>
      ) : null}
    </div>
  );
}

function ActivityPanel({
  block,
  toolCallGroups,
  renderToolCallGroups,
  missingToolStatus,
  isLive,
}: {
  block: Extract<AssistantTimelineBlock, { type: "activity" }>;
  toolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  missingToolStatus: ToolCallStatus;
  isLive: boolean;
}) {
  const [open, setOpen] = useAutoCollapsePanel(isLive);
  const summary = summarizeActivity(block.rounds.flatMap((round) => round.events), toolCallGroups, missingToolStatus);

  return (
    <details
      className={`collapsiblePanel activity-block ${summary.status}${isLive ? " live" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="collapsiblePanelSummary">
        <span className="collapsiblePanelTitle">{t("chat.activities")}</span>
        <span className="collapsiblePanelChevron" aria-hidden="true" />
      </summary>
      <div className="collapsiblePanelBody activityBody">
        {block.rounds.map((round) => (
          <ActivityRound
            key={round.id}
            round={round}
            toolCallGroups={toolCallGroups}
            renderToolCallGroups={renderToolCallGroups}
            isLive={isLive}
          />
        ))}
      </div>
    </details>
  );
}

function ActivityRound({
  round,
  toolCallGroups,
  renderToolCallGroups,
  isLive,
}: {
  round: AssistantActivityRound;
  toolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  isLive: boolean;
}) {
  return (
    <>
      {round.events.map((event) => {
        if (event.type === "content") {
          return (
            <div className="activityNarration" key={event.id}>
              <MarkdownMessage content={event.content} role="assistant" />
            </div>
          );
        }
        if (event.type === "reasoning") {
          return <ReasoningBlock key={event.id} content={event.content} isLive={isLive} />;
        }
        return (
          <RoundToolCallList
            key={event.id}
            event={event}
            toolCallGroups={toolCallGroups}
            renderToolCallGroups={renderToolCallGroups}
            isLive={isLive}
          />
        );
      })}
    </>
  );
}

function RoundToolCallList({
  event,
  toolCallGroups,
  renderToolCallGroups,
  isLive,
}: {
  event: Extract<AssistantTimelineEvent, { type: "tool-group" }>;
  toolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  isLive: boolean;
}) {
  const group = findTimelineToolGroup(event, toolCallGroups);
  const [open, setOpen] = useAutoCollapsePanel(isLive);

  if (!group || group.toolCalls.length === 0) {
    return null;
  }

  return (
    <details
      className="collapsiblePanel activityToolList"
      open={open}
      onToggle={(toggleEvent) => setOpen(toggleEvent.currentTarget.open)}
    >
      <summary className="collapsiblePanelSummary activityToolListSummary">
        <span className="collapsiblePanelTitle">
          {t("chat.toolCallItems", { count: group.toolCalls.length })}
        </span>
        <span className="collapsiblePanelChevron" aria-hidden="true" />
      </summary>
      <div className="collapsiblePanelBody activityToolListBody">
        {renderToolCallGroups?.([group])}
      </div>
    </details>
  );
}

function ReasoningBlock({ content, isLive }: { content: string; isLive: boolean }) {
  const [open, setOpen] = useAutoCollapsePanel(isLive);

  return (
    <details
      className="collapsiblePanel activityReasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="collapsiblePanelSummary activityReasoningSummary">
        <span className="collapsiblePanelTitle">{t("chat.reasoning")}</span>
        <span className="collapsiblePanelChevron" aria-hidden="true" />
      </summary>
      <div className="reasoning-content">
        <MarkdownMessage content={content} role="assistant" />
      </div>
    </details>
  );
}

function getMissingToolStatus(
  blocks: AssistantTimelineBlock[],
  blockIndex: number,
  isActive: boolean,
  generationStatus: ChatMessage["generationStatus"],
): ToolCallStatus {
  if (generationStatus === "completed") {return "completed";}
  if (blocks.slice(blockIndex + 1).some((block) => block.type === "content")) {return "completed";}
  if (isActive) {return "pending";}
  return generationStatus === "error" ? "error" : "cancelled";
}

function findTimelineToolGroup(
  event: Extract<AssistantTimelineEvent, { type: "tool-group" }>,
  groups: ToolCallGroup[],
): ToolCallGroup | undefined {
  const group = groups.find((candidate) => candidate.round === event.round);
  if (!group) {
    return undefined;
  }
  const ids = new Set(event.toolCallIds);
  return {
    ...group,
    toolCalls: group.toolCalls.filter((toolCall) => ids.has(toolCall.toolCallId)),
  };
}

export type { ChatMessage };

import { ScreenshotPreview } from "../results/ScreenshotPreview";
import { screenshotReferences } from "../results/ScreenshotReferences";
import type { VsCodeApi } from "@webview/VsCodeApi";
import type { ToolCallGroup, ToolCallState } from "@webview/views/chatView/ChatViewTypes";
import CollapsiblePanel from "../../../shared/collapsiblePanel/CollapsiblePanel";
import {
  getToolCallFileChange,
  getToolCallFilePath,
} from "../results/FileToolPresentation";
import { renderToolCallResultPreview } from "../results/ToolCallResultPreview";
import { renderToolCallArgumentsPreview } from "../results/ToolCallResultRenderers";
import "../results/ToolCallResultPreview.css";
import "./ToolCallTimeline.css";
import { t } from "@webview/i18n";

interface ToolCallTimelineProps {
  groups: ToolCallGroup[];
  vscode: VsCodeApi | null;
  conversationId?: string;
}

function ToolCallTimeline({ groups, vscode, conversationId }: ToolCallTimelineProps) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="toolCallTimeline" aria-label={t("tools.toolCalls")}>
      {groups.map((group) => (
        <div className="toolCallGroup" key={group.id}>
          {group.toolCalls.map((toolCall) => (
            <ToolCallItem
              key={toolCall.toolCallId}
              toolCall={toolCall}
              vscode={vscode}
              conversationId={conversationId}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ToolCallItemProps {
  toolCall: ToolCallState;
  vscode: VsCodeApi | null;
  conversationId?: string;
}

function ToolCallItem({ toolCall, vscode, conversationId }: ToolCallItemProps) {
  const filePath = getToolCallFilePath(toolCall);
  const fileChange = getToolCallFileChange(toolCall);

  return (
    <CollapsiblePanel
      title={<span className="toolCallName">{toolCall.toolName}</span>}
      meta={<span className={`toolCallStatus ${toolCall.status}`} role="status" aria-live="polite">{formatStatus(toolCall.status)}</span>}
      className={`toolCallItem ${toolCall.status}`}
      bodyClassName="toolCallItemBody"
    >
      {filePath && vscode ? (
        <div className="toolCallActions">
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "openFile", path: filePath, conversationId })}
          >
            {t("tools.openFile")}
          </button>
          {fileChange ? (
            <button
              type="button"
              onClick={() => vscode.postMessage({
                type: "openFileDiff",
                path: fileChange.path,
                diff: fileChange.diff,
                beforeHash: fileChange.beforeHash,
                afterHash: fileChange.afterHash,
                conversationId,
              })}
            >
              {t("tools.viewChange")}
            </button>
          ) : null}
        </div>
      ) : null}
      {toolCall.arguments ? <div className="toolCallArgs">{renderToolCallArgumentsPreview(toolCall.toolName, toolCall.arguments)}</div> : null}
      {conversationId && vscode ? screenshotReferences(toolCall.toolName, toolCall.result).map((id) => <ScreenshotPreview key={id} id={id} conversationId={conversationId} vscode={vscode} />) : null}
      {renderToolCallResultPreview({ toolCall, vscode })}
    </CollapsiblePanel>
  );
}

function formatStatus(status: ToolCallState["status"]): string {
  switch (status) {
    case "pending":
      return t("tools.pending");
    case "awaiting_confirmation":
      return t("tools.awaitingConfirmation");
    case "running":
      return t("tools.running");
    case "completed":
      return t("tools.completed");
    case "error":
      return t("tools.error");
    case "rejected":
      return t("tools.rejected");
    case "cancelled":
      return t("tools.cancelled");
  }
}

export default ToolCallTimeline;

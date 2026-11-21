import { useId } from "react";
import { getVsCodeApi } from "@webview/VsCodeApi";
import type { ToolCallState } from "@webview/views/chatView/ChatViewTypes";
import DangerConfirmation from "./ToolCallDangerConfirmation";
import { renderToolCallArgumentsPreview } from "../results/ToolCallResultRenderers";
import "../results/ToolCallResultPreview.css";
import "./ToolCallConfirmationModal.css";
import { useDialogFocus } from "./UseDialogFocus";
import { t } from "@webview/i18n";

interface ToolCallConfirmationModalProps {
  pendingToolCalls: ToolCallState[];
  onExecute: (toolCallId: string) => void;
  onReject: (toolCallId: string) => void;
  onExecuteAll: () => void;
  onRejectAll: () => void;
  disabled?: boolean;
}

function ToolCallConfirmationModal({ pendingToolCalls, onExecute, onReject, onExecuteAll, onRejectAll, disabled = false }: ToolCallConfirmationModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const activeToolCall = pendingToolCalls[0];
  const dialogRef = useDialogFocus(
    () => {
      if (activeToolCall) {onReject(activeToolCall.toolCallId);}
    },
    activeToolCall?.toolCallId ?? "closed",
    Boolean(activeToolCall),
  );

  if (!activeToolCall) {return null;}

  const manualBatchCount = pendingToolCalls.filter((toolCall) => toolCall.requiresConfirmation && !toolCall.dangerConfirmation).length;
  const filePath = activeToolCall.dangerConfirmation?.filePath ?? getArgumentValue(activeToolCall.arguments, "path");
  const dangerTitle = getDangerTitle(activeToolCall.dangerConfirmation?.dangerLevel);
  const title = activeToolCall.dangerConfirmation
    ? `${dangerTitle}: ${activeToolCall.dangerConfirmation.warningMessage}`
    : activeToolCall.toolName;
  const subtitle = activeToolCall.dangerConfirmation
    ? filePath
      ? t("confirmations.filePath", { path: filePath })
      : t("confirmations.reviewBeforeExecuting")
    : undefined;

  return (
    <div className="toolCallModalBackdrop" role="presentation" onMouseDown={(event) => event.stopPropagation()}>
      <section
        ref={dialogRef}
        className="toolCallModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="toolCallModalHeader">
          <div>
            <h3 id={titleId}>{title}</h3>
            {subtitle ? <p id={descriptionId}>{subtitle}</p> : null}
          </div>
          <span className={`toolCallStatus ${activeToolCall.status}`}>{activeToolCall.status}</span>
        </header>

        {activeToolCall.arguments ? (
          <details className="toolCallModalDetails" open>
            <summary>
              <span>{t("confirmations.reviewDetails")}</span>
            </summary>
            <div className="toolCallModalArgs">
              <ArgumentsReview toolName={activeToolCall.toolName} argumentsJson={activeToolCall.arguments} />
              {filePath && canOpenToolPath(activeToolCall.toolName) ? (
                <button type="button" className="toolCallOpenFile" onClick={() => getVsCodeApi()?.postMessage({ type: "openFile", path: filePath })}>
                  {t("confirmations.openFileInEditor")}
                </button>
              ) : null}
            </div>
          </details>
        ) : null}

        {activeToolCall.dangerConfirmation ? (
          <DangerConfirmation
            toolCallId={activeToolCall.toolCallId}
            dangerConfirmation={activeToolCall.dangerConfirmation}
            onConfirm={onExecute}
            onCancel={onReject}
            disabled={disabled}
          />
        ) : (
          <div className="toolCallDecisionRow">
            <button type="button" className="toolCallDecisionOption primary" disabled={disabled} onClick={() => onExecute(activeToolCall.toolCallId)}>
              {t("confirmations.executeOnce")}
            </button>
            <button type="button" className="toolCallDecisionOption" disabled={disabled} data-dialog-initial-focus onClick={() => onReject(activeToolCall.toolCallId)}>
              {t("confirmations.reject")}
            </button>
          </div>
        )}

        {manualBatchCount > 1 ? (
          <div className="toolCallModalBatchActions">
            <button type="button" className="toolCallActionBtn" disabled={disabled} onClick={onExecuteAll}>
              {t("confirmations.executeAllManualToolsOnce")}
            </button>
            <button type="button" className="toolCallActionBtn secondary" disabled={disabled} onClick={onRejectAll}>
              {t("confirmations.rejectAllManualTools")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ArgumentsReview({ toolName, argumentsJson }: { toolName: string; argumentsJson: string }) {
  if (toolName === "list_directory" || toolName === "read_file") {
    return renderToolCallArgumentsPreview(toolName, argumentsJson);
  }

  const parsed = parseArguments(argumentsJson);
  const reviewContent = getReviewContent(toolName, parsed, argumentsJson);
  const isDiff = toolName === "apply_patch" || reviewContent.includes("@@ ") || reviewContent.startsWith("*** Begin Patch");

  return (
    <pre className={`toolCallFullReview${isDiff ? " diffReview" : ""}`} tabIndex={0} aria-label={t("confirmations.completeArgumentsForTool", { tool: toolName })}>
      <code>{isDiff ? renderDiff(reviewContent) : reviewContent}</code>
    </pre>
  );
}

function canOpenToolPath(toolName: string): boolean {
  return toolName === "read_file" || toolName === "create_file" || toolName === "edit_file";
}

function parseArguments(argumentsJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getReviewContent(toolName: string, parsed: Record<string, unknown> | null, fallback: string): string {
  if (!parsed) {return fallback;}
  const contentKeys = toolName === "apply_patch" ? ["patch", "content"] : ["command", "content", "replace", "query"];
  for (const key of contentKeys) {
    if (typeof parsed[key] === "string") {return parsed[key] as string;}
  }
  return JSON.stringify(parsed, null, 2);
}

function renderDiff(content: string) {
  return content.split("\n").map((line, index) => {
    const kind = line.startsWith("+") ? "diffAdd" : line.startsWith("-") ? "diffRemove" : line.startsWith("@@") || line.startsWith("***") ? "diffHunk" : "";
    return (
      <span key={index} className={`toolCallReviewLine ${kind}`}>
        {line}{"\n"}
      </span>
    );
  });
}

function getArgumentValue(argumentsJson: string | undefined, key: string): string | undefined {
  if (!argumentsJson) {return undefined;}
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

function getDangerTitle(dangerLevel: string | undefined): string {
  if (dangerLevel === "destructive") {return t("confirmations.destructiveAction");}
  if (dangerLevel === "dangerous") {return t("confirmations.potentiallyDangerousAction");}
  return t("confirmations.cautionRequired");
}

export default ToolCallConfirmationModal;

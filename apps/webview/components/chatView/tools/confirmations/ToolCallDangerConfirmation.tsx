import type { DangerConfirmationData } from "@webview/views/chatView/ChatViewTypes";
import "./ToolCallDangerConfirmation.css";
import { t } from "@webview/i18n";

interface DangerConfirmationProps {
  toolCallId: string;
  dangerConfirmation: DangerConfirmationData;
  onConfirm: (toolCallId: string) => void;
  onCancel: (toolCallId: string) => void;
  disabled?: boolean;
}

function DangerConfirmation({ toolCallId, dangerConfirmation, onConfirm, onCancel, disabled = false }: DangerConfirmationProps) {
  const dangerLevel = dangerConfirmation.dangerLevel;
  const severityClass = dangerLevel === "destructive" ? "severityDestructive" : dangerLevel === "dangerous" ? "severityDangerous" : "severityCaution";
  const isDestructive = dangerLevel === "destructive";

  return (
    <div className={`dangerConfirmation ${severityClass}`}>
      {dangerConfirmation.cwd ? <div className="dangerExecutionContext"><strong>{t("confirmations.workingDirectory")}</strong> <code>{dangerConfirmation.cwd}</code></div> : null}
      {dangerConfirmation.shell ? <div className="dangerExecutionContext"><strong>{t("confirmations.shell")}</strong> <code>{dangerConfirmation.shell}</code></div> : null}

      <p className="dangerTrustExplanation">{t("confirmations.destructiveOnceDescription")}</p>

      <div className="toolCallDecisionRow dangerDecisionRow">
        <button
          type="button"
          className="toolCallDecisionOption primary dangerPrimaryAction dangerConfirmBtn"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onConfirm(toolCallId);
          }}
        >
          {isDestructive ? t("confirmations.yesExecuteOnce") : t("confirmations.executeOnce")}
        </button>
        <button
          type="button"
          className="toolCallDecisionOption dangerCancelBtn"
          disabled={disabled}
          data-dialog-initial-focus
          onClick={(event) => {
            event.stopPropagation();
            onCancel(toolCallId);
          }}
        >
          {t("confirmations.cancel")}
        </button>
      </div>
    </div>
  );
}

export default DangerConfirmation;

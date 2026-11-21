import { useId } from "react";
import { t } from "@webview/i18n";
import { useDialogFocus } from "@webview/components/chatView/tools/confirmations/UseDialogFocus";
import "./WorkspaceMismatchModal.css";

export default function WorkspaceMismatchModal({
  workspaceName,
  onConfirm,
  onCancel,
}: {
  workspaceName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus(onCancel, workspaceName, true);

  return (
    <div className="workspaceMismatchBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="workspaceMismatchPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="workspaceMismatchHeader">
          <span className="codicon codicon-warning" aria-hidden="true" />
          <h3 id={titleId}>{t("history.workspaceMismatch.title")}</h3>
        </div>
        <div className="workspaceMismatchNotice">
          <p id={descriptionId}>{t("history.workspaceMismatch.description", { workspace: workspaceName })}</p>
        </div>
        <div className="workspaceMismatchActions">
          <button
            type="button"
            className="workspaceMismatchAction primary"
            data-dialog-initial-focus
            onClick={onConfirm}
          >
            <span className="codicon codicon-arrow-right" aria-hidden="true" />
            {t("history.workspaceMismatch.confirm")}
          </button>
          <button type="button" className="workspaceMismatchAction" onClick={onCancel}>
            <span className="codicon codicon-close" aria-hidden="true" />
            {t("history.workspaceMismatch.cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}

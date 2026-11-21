import { useId } from "react";
import type { HandlerToWebviewMessage } from "@/contracts";
import { t } from "@webview/i18n";
import { useDialogFocus } from "@webview/components/chatView/tools/confirmations/UseDialogFocus";
import "./HistoryTransitionPanel.css";

export type HistoryTransition = Extract<HandlerToWebviewMessage, { type: "historyTransitionRequired" }>;

export default function HistoryTransitionPanel({
  transition,
  onDecision,
}: {
  transition: HistoryTransition | null;
  onDecision: (decision: "stop" | "save" | "discard" | "cancel") => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus(
    () => onDecision("cancel"),
    transition?.requestId ?? "closed",
    Boolean(transition),
  );
  if (!transition) {return null;}

  const isStopPhase = transition.phase === "stop-work";
  const isEntering = transition.direction === "enter-incognito";
  const hasWork = transition.activeGenerations > 0 || transition.queuedMessages > 0;
  return (
    <div className="historyTransitionBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="historyTransitionPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="historyTransitionHeader">
          <span className="historyTransitionIcon" aria-hidden="true">
            <span className={`codicon ${isEntering ? "codicon-eye-closed" : "codicon-history"}`} />
          </span>
          <div>
            <h3 id={titleId}>{t(isStopPhase
              ? isEntering ? "settings.history.transition.workTitle" : "settings.history.transition.exitWorkTitle"
              : "settings.history.transition.exitTitle")}</h3>
            <span className="historyTransitionMode">{t("settings.history.incognito")}</span>
          </div>
        </div>
        <div className={`historyTransitionNotice${isStopPhase && hasWork ? " warning" : ""}`}>
          <span className={`codicon ${isStopPhase && hasWork ? "codicon-warning" : "codicon-info"}`} aria-hidden="true" />
          <p id={descriptionId}>
            {isStopPhase
              ? hasWork
                ? t("settings.history.transition.workDescription", {
                  generations: transition.activeGenerations,
                  queued: transition.queuedMessages,
                })
                : t(isEntering ? "settings.history.transition.workFinished" : "settings.history.transition.exitWorkFinished")
              : t("settings.history.transition.exitDescription")}
          </p>
        </div>
        <div className="historyTransitionActions">
          {isStopPhase ? (
            <button type="button" className="historyTransitionAction primary" data-dialog-initial-focus onClick={() => onDecision("stop")}>
              <span className={`codicon ${hasWork ? "codicon-debug-stop" : "codicon-arrow-right"}`} aria-hidden="true" />
              {t(hasWork
                ? isEntering ? "settings.history.transition.stopAndEnter" : "settings.history.transition.stopAndContinue"
                : isEntering ? "settings.history.transition.enter" : "settings.history.transition.continueExit")}
            </button>
          ) : (
            <>
              <button type="button" className="historyTransitionAction primary" data-dialog-initial-focus onClick={() => onDecision("save")}>
                <span className="codicon codicon-save" aria-hidden="true" />
                {t("settings.history.transition.saveAndExit")}
              </button>
              <button type="button" className="historyTransitionAction" onClick={() => onDecision("discard")}>
                <span className="codicon codicon-trash" aria-hidden="true" />
                {t("settings.history.transition.discardAndExit")}
              </button>
            </>
          )}
          <button type="button" className="historyTransitionAction" onClick={() => onDecision("cancel")}>
            <span className="codicon codicon-close" aria-hidden="true" />
            {t(isStopPhase ? "settings.history.transition.cancelAndWait" : "settings.history.transition.cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}

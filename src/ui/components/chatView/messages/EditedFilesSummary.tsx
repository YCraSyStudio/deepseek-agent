import { useEffect, useMemo, useState } from "react";
import type { ToolCallGroup } from "@webview/views/chatView/ChatViewTypes";
import { t } from "@webview/i18n";
import { useVsCode } from "@webview/views/chatView/contexts";
import { collectTurnFileEdits, type TurnFileEdit } from "../tools/results/FileEditSummary";
import "./EditedFilesSummary.css";

const COLLAPSED_FILE_LIMIT = 3;

interface EditedFilesSummaryProps {
  toolCallGroups: ToolCallGroup[];
  conversationId?: string;
  generationId?: string;
}

function EditedFilesSummary({ toolCallGroups, conversationId, generationId }: EditedFilesSummaryProps) {
  const vscode = useVsCode();
  const files = useMemo(() => collectTurnFileEdits(toolCallGroups), [toolCallGroups]);
  const [showAll, setShowAll] = useState(false);
  const [review, setReview] = useState<{ paths: string[]; reverted: boolean }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vscode || !conversationId || !generationId) {return;}
    const listener = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type !== "workspaceTurn" || message.conversationId !== conversationId || message.generationId !== generationId) {return;}
      setPending(false);
      if (message.error) {
        if (!String(message.requestId).startsWith("turn-query:")) {setError(message.error);}
      } else {setReview({ paths: message.paths, reverted: message.reverted }); setError("");}
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ type: "getWorkspaceTurn", requestId: `turn-query:${generationId}`, conversationId, generationId });
    return () => window.removeEventListener("message", listener);
  }, [vscode, conversationId, generationId]);

  if (!vscode || (files.length === 0 && !review?.paths.length)) {
    return null;
  }

  const totals = files.reduce(
    (acc, file) => ({ additions: acc.additions + file.additions, deletions: acc.deletions + file.deletions }),
    { additions: 0, deletions: 0 },
  );
  const visibleFiles = showAll ? files : files.slice(0, COLLAPSED_FILE_LIMIT);
  const hiddenCount = files.length - visibleFiles.length;

  const openChange = (file: TurnFileEdit) => {
    vscode.postMessage({
      type: "openFileDiff",
      path: file.path,
      diff: file.diff,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      preview: true,
      conversationId,
      generationId,
    });
  };
  const action = (type: "reviewWorkspaceTurn" | "revertWorkspaceTurn") => {
    if (!conversationId || !generationId) {return;}
    setPending(true);
    setError("");
    vscode.postMessage({ type, requestId: `${type}:${generationId}`, conversationId, generationId });
  };

  return (
    <div className="editedFilesSummary">
      <div className="editedFilesHeader">
        <span className="editedFilesTitle">
          {(review?.paths.length ?? files.length) === 1
            ? t("tools.editedFilesOne")
            : t("tools.editedFilesMany", { count: review?.paths.length ?? files.length })}
        </span>
        {files.length > 0 ? <span className="editedFilesTotals">
          <span className="editedFilesAdditions">+{totals.additions}</span>
          <span className="editedFilesDeletions">-{totals.deletions}</span>
        </span> : null}
      </div>
      {files.length > 0 ? <ul className="editedFilesList">
        {visibleFiles.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className="editedFileRow"
              data-tooltip={t("tools.viewChange")}
              onClick={() => openChange(file)}
            >
              <span className="editedFilePath">{file.path}</span>
              <span className="editedFileStats">
                <span className="editedFilesAdditions">+{file.additions}</span>
                <span className="editedFilesDeletions">-{file.deletions}</span>
              </span>
            </button>
          </li>
        ))}
      </ul> : null}
      {files.length > COLLAPSED_FILE_LIMIT ? (
        <button type="button" className="editedFilesToggle" onClick={() => setShowAll((value) => !value)}>
          <span className={`codicon codicon-chevron-${showAll ? "up" : "down"}`} aria-hidden="true" />
          {showAll ? t("tools.hideExtraFiles") : t("tools.showMoreFiles", { count: hiddenCount })}
        </button>
      ) : null}
      {review?.paths.length ? (
        <div className="editedFilesActions">
          <button type="button" disabled={pending} onClick={() => action("reviewWorkspaceTurn")}>{t("tools.reviewTurn")}</button>
          <button type="button" disabled={pending || review.reverted} onClick={() => action("revertWorkspaceTurn")}>
            <span className="codicon codicon-discard" aria-hidden="true" /> {t(review.reverted ? "tools.turnReverted" : "tools.revertTurn")}
          </button>
        </div>
      ) : null}
      {error ? <p className="editedFilesError" role="alert">{error}</p> : null}
    </div>
  );
}

export default EditedFilesSummary;

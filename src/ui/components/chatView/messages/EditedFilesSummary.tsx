import { useMemo, useState } from "react";
import type { ToolCallGroup } from "@webview/views/chatView/ChatViewTypes";
import { t } from "@webview/i18n";
import { useVsCode } from "@webview/views/chatView/contexts";
import { collectTurnFileEdits, type TurnFileEdit } from "../tools/results/FileEditSummary";
import "./EditedFilesSummary.css";

const COLLAPSED_FILE_LIMIT = 3;

interface EditedFilesSummaryProps {
  toolCallGroups: ToolCallGroup[];
}

function EditedFilesSummary({ toolCallGroups }: EditedFilesSummaryProps) {
  const vscode = useVsCode();
  const files = useMemo(() => collectTurnFileEdits(toolCallGroups), [toolCallGroups]);
  const [showAll, setShowAll] = useState(false);

  if (!vscode || files.length === 0) {
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
    });
  };

  return (
    <div className="editedFilesSummary">
      <div className="editedFilesHeader">
        <span className="editedFilesTitle">
          {files.length === 1
            ? t("tools.editedFilesOne")
            : t("tools.editedFilesMany", { count: files.length })}
        </span>
        <span className="editedFilesTotals">
          <span className="editedFilesAdditions">+{totals.additions}</span>
          <span className="editedFilesDeletions">-{totals.deletions}</span>
        </span>
      </div>
      <ul className="editedFilesList">
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
      </ul>
      {files.length > COLLAPSED_FILE_LIMIT ? (
        <button type="button" className="editedFilesToggle" onClick={() => setShowAll((value) => !value)}>
          <span className={`codicon codicon-chevron-${showAll ? "up" : "down"}`} aria-hidden="true" />
          {showAll ? t("tools.hideExtraFiles") : t("tools.showMoreFiles", { count: hiddenCount })}
        </button>
      ) : null}
    </div>
  );
}

export default EditedFilesSummary;

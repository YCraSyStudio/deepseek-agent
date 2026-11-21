import type { ReferencedFile } from "@/contracts";
import { t } from "@webview/i18n";

interface ReferencedFilesChipsProps {
  files: ReferencedFile[];
  onRemove: (index: number) => void;
}

function ReferencedFilesChips({ files, onRemove }: ReferencedFilesChipsProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="referencedFiles">
      {files.map((file, index) => (
        <span key={index} className="fileChip" data-tooltip={file.path}>
          <span className="fileChipIcon">{file.type === "directory" ? "📁" : "📄"}</span>
          <span className="fileChipName">{file.name ?? file.path}</span>
          {file.size && file.size > 1_048_576 && <span className="fileChipWarn">⚠️ {t("chat.large")}</span>}
          {file.type === "directory" && <span className="fileChipLabel">{t("chat.folder")}</span>}
          <button className="fileChipRemove" onClick={() => onRemove(index)} aria-label={t("chat.removeFile")}>
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

export default ReferencedFilesChips;

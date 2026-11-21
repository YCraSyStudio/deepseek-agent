import type { VsCodeApi } from "@webview/VsCodeApi";
import { parseSearchResults } from "@webview/views/chatView/utils/SearchResults";
import { t } from "@webview/i18n";

type SearchResult = { file: string; line: number; text: string };

export function renderSearchPreview(
  result: string,
  status: string,
  vscode: VsCodeApi | null,
) {
  const results = parseSearchResults(result);
  if (results.length === 0) {
    const isError = status === "error";
    return (
      <details className="toolCallResult" open={isError}>
        <summary>{isError ? t("tools.error") : t("results.result")}</summary>
        <pre className={isError ? "errorText" : ""}>{truncate(result, 1000)}</pre>
      </details>
    );
  }
  return renderSearchResults(results, vscode);
}

export function renderSearchResults(
  results: SearchResult[],
  vscode: VsCodeApi | null,
  truncated = false,
) {
  return (
    <div className="filePreview searchPreview">
      <div className="filePreviewHeader">
        <span className="filePreviewName">{t("results.searchResults")}</span>
        <span className="filePreviewSize">
          {t("results.countResults", { count: results.length })}
        </span>
      </div>
      <div className="searchResultsList">
        {results.slice(0, 30).map((resultItem, index) => (
          <button
            key={index}
            className="searchResultItem"
            onClick={() =>
              vscode?.postMessage({
                type: "openFile",
                path: resultItem.file,
                line: resultItem.line,
              })
            }
            data-tooltip={t("results.clickToOpenPathLine", {
              path: resultItem.file,
              line: resultItem.line,
            })}
            data-tooltip-align="start"
          >
            <span className="searchResultFile">{resultItem.file}</span>
            <span className="searchResultLine">:{resultItem.line}</span>
            <span className="searchResultText">{resultItem.text}</span>
          </button>
        ))}
        {(results.length > 30 || truncated) && (
          <div className="searchResultMore">
            {t("results.andCountMoreResults", {
              count: Math.max(results.length - 30, 0),
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
}

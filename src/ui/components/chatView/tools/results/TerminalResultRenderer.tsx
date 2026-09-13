import type { TerminalCommandResult } from "@webview/views/chatView/utils/FilePreviewTypes";
import { t } from "@webview/i18n";
import { useState } from "react";

export function renderTerminalResult(result: TerminalCommandResult) {
  const duration =
    result.durationMs < 1000
      ? `${Math.round(result.durationMs)} ms`
      : `${(result.durationMs / 1000).toFixed(1)} s`;
  const outcome = result.cancelled
    ? t("results.cancelled")
    : result.timedOut
      ? t("results.timedOut")
      : t("results.exitCode", { code: result.exitCode ?? t("results.unknown") });
  const stdoutPreviewTruncated = result.stdout.length > 16_000;
  const stderrPreviewTruncated = result.stderr.length > 16_000;

  return (
    <div className="terminalResult">
      <div className="terminalMetadata" aria-label={t("results.terminalCommandMetadata")}>
        <span
          className={`terminalOutcome ${
            result.exitCode === 0 && !result.timedOut && !result.cancelled
              ? "success"
              : "failure"
          }`}
        >
          {outcome}
        </span>
        <span>{duration}</span>
        <span title={result.cwd}>{t("results.cwdCwd", { cwd: result.cwd })}</span>
        <span title={result.shell}>{t("results.shellShell", { shell: result.shell })}</span>
        {result.signal ? (
          <span>{t("results.signalSignal", { signal: result.signal })}</span>
        ) : null}
        {result.truncated.stdout || result.truncated.stderr ? (
          <span>{t("results.outputTruncated")}</span>
        ) : null}
      </div>
      {result.stdout ? (
        <details className="terminalStream" open>
          <summary>
            stdout
            {result.truncated.stdout || stdoutPreviewTruncated
              ? t("results.truncatedPreview")
              : ""}
          </summary>
          <pre>{truncate(result.stdout, 16_000)}</pre>
          {stdoutPreviewTruncated ? <RetainedOutput value={result.stdout} /> : null}
        </details>
      ) : null}
      {result.stderr ? (
        <details className="terminalStream terminalStderr" open>
          <summary>
            stderr
            {result.truncated.stderr || stderrPreviewTruncated
              ? t("results.truncatedPreview")
              : ""}
          </summary>
          <pre>{truncate(result.stderr, 16_000)}</pre>
          {stderrPreviewTruncated ? <RetainedOutput value={result.stderr} /> : null}
        </details>
      ) : null}
      {!result.stdout && !result.stderr ? (
        <div className="filePreviewNotice">
          {t("results.commandCompletedWithoutOutput")}
        </div>
      ) : null}
    </div>
  );
}

function RetainedOutput({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("results.retainedOutput")}</summary>
      {open ? <textarea readOnly aria-label={t("results.retainedOutput")} value={value} rows={20} style={{ width: "100%" }} /> : null}
    </details>
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
}

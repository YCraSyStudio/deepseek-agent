import { useEffect, useState } from "react";
import type { StorageInfo } from "@/contracts/Storage";
import { SettingsField, SettingsInputAction } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import "./StorageSection.css";

export default function StorageSection({ info, pending, error, onSave, onBrowse, onReload }: {
  info: StorageInfo;
  pending: boolean;
  error?: string;
  onSave: (directory: string) => void;
  onBrowse: () => void;
  onReload: () => void;
}) {
  const [directory, setDirectory] = useState(info.configuredDirectory);
  useEffect(() => {setDirectory(info.configuredDirectory);}, [info.configuredDirectory]);
  const needsReload = info.directory !== info.configuredDirectory;

  return (
    <SettingsField className="storageSection" label={t("settings.storage.directory")} htmlFor="storageDirectory" layout="wide" busy={pending}>
      <div className="storagePathRow">
        <SettingsInputAction action={
          <button type="button" className="btn-secondary storageBrowse" disabled={pending} onClick={onBrowse}
            aria-label={t("settings.storage.browse")} data-tooltip={t("settings.storage.browse")}>
            <i className="codicon codicon-folder-opened" aria-hidden="true" />
          </button>
        }>
          <input
            id="storageDirectory"
            type="text"
            value={directory}
            placeholder={info.defaultDirectory}
            disabled={pending}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={error ? "storageError" : needsReload ? "storageReloadHint" : undefined}
            onChange={(event) => setDirectory(event.currentTarget.value)}
            onBlur={(event) => {
              // These controls choose their own path; do not save the unfinished draft first.
              if (event.relatedTarget instanceof Element && event.relatedTarget.closest(".storageBrowse, .storageDefault")) {return;}
              const value = event.currentTarget.value.trim();
              if (value && value !== info.configuredDirectory && !pending) {onSave(value);}
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {event.currentTarget.blur();}
            }}
          />
        </SettingsInputAction>
        <button type="button" className="btn-secondary storageDefault" disabled={pending} data-tooltip={info.defaultDirectory}
          onClick={() => {setDirectory(info.defaultDirectory); onSave(info.defaultDirectory);}}>{t("settings.storage.default")}</button>
      </div>
      {error ? <p id="storageError" className="storageError" role="alert">{t("settings.storage.error")} {error}</p> : null}
      {needsReload ? (
        <div className="storageReload" role="status">
          <p id="storageReloadHint">{t("settings.storage.reloadHint")}</p>
          <button type="button" className="btn-secondary" disabled={pending} onClick={onReload}>{t("settings.storage.reload")}</button>
        </div>
      ) : null}
    </SettingsField>
  );
}

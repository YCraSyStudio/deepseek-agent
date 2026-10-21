import { t } from "@webview/i18n";
import "./SettingLabel.css";

type SettingLabelProps = {
  htmlFor: string;
  label: string;
  help?: string;
};

export default function SettingLabel({ htmlFor, label, help }: SettingLabelProps) {
  return (
    <div className="settingLabel">
      <label htmlFor={htmlFor}>{label}</label>
      {help && (
        <button
          type="button"
          className="settingHelp"
          aria-label={t("settings.help", { setting: label })}
          data-tooltip={help}
          data-tooltip-position="bottom"
        >
          <span className="codicon codicon-question" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

import type { GeneralSectionProps } from "../model";
import { SettingsGroup, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";

export default function PrivacySection({ config, updateConfig, saveOnBlur }: GeneralSectionProps) {
  return (
    <SettingsGroup title={t("settings.privacy.title")}>
      <Toggle
        id="privacyMinimizeData"
        label={t("settings.privacy.minimize")}
        tooltip={`${t("settings.privacy.description")}\n\n${t("settings.privacy.limits")}`}
        checked={config.privacyMinimizeData}
        onToggle={(enabled) => {
          updateConfig("privacyMinimizeData", enabled);
          saveOnBlur("privacyMinimizeData", enabled);
        }}
      />
    </SettingsGroup>
  );
}

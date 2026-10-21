import type { GeneralSectionProps } from "../model";
import { Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";

export default function PrivacySection({ config, updateConfig, saveOnBlur }: GeneralSectionProps) {
  return (
    <section className="privacySection" aria-labelledby="privacyHeading">
      <h3 id="privacyHeading" className="sectionTitle">{t("settings.privacy.title")}</h3>
      <Toggle
        id="privacyMinimizeData"
        label={t("settings.privacy.minimize")}
        help={`${t("settings.privacy.description")}\n\n${t("settings.privacy.limits")}`}
        checked={config.privacyMinimizeData}
        onToggle={(enabled) => {
          updateConfig("privacyMinimizeData", enabled);
          saveOnBlur("privacyMinimizeData", enabled);
        }}
      />
    </section>
  );
}

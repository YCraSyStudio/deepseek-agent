import type { SettingsConfig, UpdateConfigFn, SaveOnBlurFn } from "../model";
import { SettingsGroup, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";

type BetaSectionProps = {
  config: Pick<SettingsConfig, "betaFeaturesEnabled" | "editorSuggestionsEnabled" | "chatSuggestionsEnabled">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
};

export default function BetaSection({ config, updateConfig, saveOnBlur }: BetaSectionProps) {
  return (
    <SettingsGroup title={t("settings.beta.title")}
      tooltip={t("settings.beta.description")}
      headerAction={(
        <input id="betaFeaturesEnabled" type="checkbox" aria-label={t("settings.beta.title")}
          checked={config.betaFeaturesEnabled} onChange={(event) => {
            updateConfig("betaFeaturesEnabled", event.currentTarget.checked);
            saveOnBlur("betaFeaturesEnabled", event.currentTarget.checked);
          }} />
      )}>
      <Toggle
        id="editorSuggestionsEnabled"
        label={t("settings.beta.editorSuggestions")}
        tooltip={t("settings.beta.editorSuggestionsHelp")}
        disabled={!config.betaFeaturesEnabled}
        checked={config.editorSuggestionsEnabled}
        onToggle={(enabled) => {
          updateConfig("editorSuggestionsEnabled", enabled);
          saveOnBlur("editorSuggestionsEnabled", enabled);
        }}
      />
      <Toggle
        id="chatSuggestionsEnabled"
        label={t("settings.beta.chatSuggestions")}
        tooltip={t("settings.beta.chatSuggestionsHelp")}
        disabled={!config.betaFeaturesEnabled}
        checked={config.chatSuggestionsEnabled}
        onToggle={(enabled) => {
          updateConfig("chatSuggestionsEnabled", enabled);
          saveOnBlur("chatSuggestionsEnabled", enabled);
        }}
      />
    </SettingsGroup>
  );
}

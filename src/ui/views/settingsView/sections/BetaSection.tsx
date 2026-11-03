import type { SettingsConfig, UpdateConfigFn, SaveOnBlurFn } from "../model";
import { SettingsGroup, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";

type BetaSectionProps = {
  config: Pick<SettingsConfig, "betaFeaturesEnabled" | "strictToolCallsEnabled" | "editorSuggestionsEnabled" | "chatSuggestionsEnabled">;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
};

export default function BetaSection({ config, updateConfig, saveOnBlur }: BetaSectionProps) {
  return (
    <SettingsGroup title={t("settings.beta.title")} tooltip={t("settings.beta.description")} collapsible
      headerAction={
        <input type="checkbox" id="betaFeaturesEnabled" aria-label={t("settings.beta.title")}
          checked={config.betaFeaturesEnabled}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const enabled = event.target.checked;
            updateConfig("betaFeaturesEnabled", enabled);
            saveOnBlur("betaFeaturesEnabled", enabled);
            if (!enabled && config.strictToolCallsEnabled) {
              updateConfig("strictToolCallsEnabled", false);
              saveOnBlur("strictToolCallsEnabled", false);
            }
          }} />
      }>
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
      <Toggle id="strictToolCallsEnabled" label={t("settings.strictTools.enabled")}
        tooltip={t("settings.strictTools.description")}
        disabled={!config.betaFeaturesEnabled}
        checked={config.strictToolCallsEnabled}
        onToggle={(enabled) => {
          updateConfig("strictToolCallsEnabled", enabled);
          saveOnBlur("strictToolCallsEnabled", enabled);
        }} />
    </SettingsGroup>
  );
}

import type { GeneralSectionProps } from "../model";
import { isUsageCurrency, type UsageCurrency } from "@/shared/usage/Usage";
import { SettingLabel, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import PrivacySection from "./PrivacySection";

function GeneralSection({ config, updateConfig, saveOnBlur }: GeneralSectionProps) {
  return (
    <section className="settingsSection generalSection">
      <h3 className="sectionTitle">{t("settings.section.extension")}</h3>

      <div className="settingRow">
        <label htmlFor="interfaceLanguage">{t("settings.language.label")}</label>
        <select
          id="interfaceLanguage"
          value={config.interfaceLanguage}
          onChange={(event) => {
            const language = parseInterfaceLanguage(event.target.value);
            if (!language) {return;}
            updateConfig("interfaceLanguage", language);
            saveOnBlur("interfaceLanguage", language);
          }}
        >
          <option value="auto">{t("settings.language.auto")}</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="zh">中文</option>
        </select>
      </div>

      <div className="settingRow">
        <SettingLabel htmlFor="historyRetentionDays" label={t("settings.history.retention")} help={t("settings.history.retentionHelp")} />
        <input
          id="historyRetentionDays"
          type="number"
          min={0}
          max={3650}
          value={config.historyRetentionDays}
          disabled={!config.historyEnabled}
          onChange={(event) => updateBoundedInteger(event.currentTarget, 0, 3650, (value) => updateConfig("historyRetentionDays", value))}
          onBlur={(event) => updateBoundedInteger(event.currentTarget, 0, 3650, (value) => saveOnBlur("historyRetentionDays", value))}
        />
      </div>

      <Toggle
        label={t("settings.instructions.globalAgents")}
        id="includeHomeAgents"
        checked={config.includeHomeAgents}
        onToggle={(checked) => {
          updateConfig("includeHomeAgents", checked);
          saveOnBlur("includeHomeAgents", checked);
        }}
      />

      <h3 className="sectionTitle">{t("settings.usage.title")}</h3>

      <div className="settingRow">
        <label htmlFor="usageCostCurrency">{t("settings.usage.currency")}</label>
        <select
          id="usageCostCurrency"
          value={config.usageCostCurrency}
          onChange={(event) => {
            const currency = parseUsageCurrency(event.target.value);
            if (!currency) {return;}
            updateConfig("usageCostCurrency", currency);
            saveOnBlur("usageCostCurrency", currency);
          }}
        >
          <option value="usd">{t("settings.usage.currencyUsd")}</option>
          <option value="cny">{t("settings.usage.currencyCny")}</option>
        </select>
      </div>

      <Toggle
        label={t("settings.usage.breakdown")}
        id="usageBreakdown"
        checked={config.usageBreakdown}
        onToggle={(checked) => {
          updateConfig("usageBreakdown", checked);
          saveOnBlur("usageBreakdown", checked);
        }}
      />

      <h3 className="sectionTitle">{t("settings.beta.title")}</h3>
      <Toggle
        id="betaFeaturesEnabled"
        label={t("settings.beta.enabled")}
        help={t("settings.beta.description")}
        checked={config.betaFeaturesEnabled}
        onToggle={(enabled) => {
          updateConfig("betaFeaturesEnabled", enabled);
          saveOnBlur("betaFeaturesEnabled", enabled);
        }}
      />
      <Toggle
        id="editorSuggestionsEnabled"
        label={t("settings.beta.editorSuggestions")}
        help={t("settings.beta.suggestionsHelp")}
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
        help={t("settings.beta.suggestionsHelp")}
        disabled={!config.betaFeaturesEnabled}
        checked={config.chatSuggestionsEnabled}
        onToggle={(enabled) => {
          updateConfig("chatSuggestionsEnabled", enabled);
          saveOnBlur("chatSuggestionsEnabled", enabled);
        }}
      />
      <PrivacySection config={config} updateConfig={updateConfig} saveOnBlur={saveOnBlur} />
    </section>
  );
}

export default GeneralSection;

function updateBoundedInteger(input: HTMLInputElement, min: number, max: number, update: (value: number) => void): void {
  const value = input.valueAsNumber;
  if (Number.isInteger(value) && value >= min && value <= max) {update(value);}
}

function parseInterfaceLanguage(value: string): "auto" | "en" | "es" | "zh" | undefined {
  return value === "auto" || value === "en" || value === "es" || value === "zh" ? value : undefined;
}

function parseUsageCurrency(value: string): UsageCurrency | undefined {
  return isUsageCurrency(value) ? value : undefined;
}

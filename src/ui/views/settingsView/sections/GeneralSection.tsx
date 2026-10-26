import type { GeneralSectionProps } from "../model";
import { isUsageCurrency, type UsageCurrency } from "@/shared/usage/Usage";
import { NumberInput, SettingsField, SettingsGroup, SettingsSection, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import PrivacySection from "./PrivacySection";

function GeneralSection({ config, updateConfig, saveOnBlur, children }: GeneralSectionProps) {
  return (
    <SettingsSection title={t("settings.section.extension")}>

      <SettingsField htmlFor="interfaceLanguage" label={t("settings.language.label")}>
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
      </SettingsField>

      <SettingsField htmlFor="historyRetentionDays" label={t("settings.history.retention")} tooltip={t("settings.history.retentionHelp")}>
        <NumberInput
          id="historyRetentionDays"
          min={0}
          max={3650}
          value={config.historyRetentionDays}
          disabled={!config.historyEnabled}
          onChange={(event) => updateBoundedInteger(event.currentTarget, 0, 3650, (value) => updateConfig("historyRetentionDays", value))}
          onBlur={(event) => updateBoundedInteger(event.currentTarget, 0, 3650, (value) => saveOnBlur("historyRetentionDays", value))}
        />
      </SettingsField>

      <SettingsField htmlFor="maxConcurrentGenerationsInput" label={t("settings.limits.maxConcurrentGenerations")}>
        <NumberInput
          id="maxConcurrentGenerationsInput"
          min={1}
          max={16}
          value={config.maxConcurrentGenerations}
          onChange={(event) => updateBoundedInteger(event.currentTarget, 1, 16, (value) => updateConfig("maxConcurrentGenerations", value))}
          onBlur={(event) => updateBoundedInteger(event.currentTarget, 1, 16, (value) => saveOnBlur("maxConcurrentGenerations", value))}
        />
      </SettingsField>

      <SettingsGroup title={t("settings.storage.title")}>
        {children}

        <SettingsField htmlFor="snapshotStorageLimitMb" label={t("settings.snapshots.storageLimit")} tooltip={t("settings.snapshots.storageHint")}>
          <NumberInput id="snapshotStorageLimitMb" min={64} max={65536} value={config.snapshotStorageLimitMb}
            onChange={(event) => updateBoundedInteger(event.currentTarget, 64, 65536, (value) => updateConfig("snapshotStorageLimitMb", value))}
            onBlur={(event) => updateBoundedInteger(event.currentTarget, 64, 65536, (value) => saveOnBlur("snapshotStorageLimitMb", value))} />
        </SettingsField>
      </SettingsGroup>
      <SettingsGroup title={t("settings.usage.title")}>
        <SettingsField htmlFor="usageCostCurrency" label={t("settings.usage.currency")}>
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
        </SettingsField>

        <Toggle
          label={t("settings.usage.breakdown")}
          id="usageBreakdown"
          checked={config.usageBreakdown}
          onToggle={(checked) => {
            updateConfig("usageBreakdown", checked);
            saveOnBlur("usageBreakdown", checked);
          }}
        />
      </SettingsGroup>
      <PrivacySection config={config} updateConfig={updateConfig} saveOnBlur={saveOnBlur} />
    </SettingsSection>
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

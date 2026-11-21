import { MAX_OUTPUT_TOKENS } from "@/contracts";
import { getApiOrigin, isLoopbackApiBaseUrl } from "@/shared/security/ApiOrigin";
import type { AdvancedSectionProps } from "../model";
import { NumberInput, SettingsField, SettingsGroup, Slider } from "@webview/components/settingsView";
import { t } from "@webview/i18n";

function AdvancedSection({ config, updateConfig, saveOnBlur }: AdvancedSectionProps) {
  return (
    <SettingsGroup title={t("settings.advanced.title")} collapsible>
      <SettingsField htmlFor="baseUrlInput" label={t("settings.api.baseUrl")} layout="wide">
        <input
          id="baseUrlInput"
          type="text"
          value={config.baseUrl}
          spellCheck={false}
          onChange={(event) => updateConfig("baseUrl", event.target.value)}
          onBlur={(event) => saveOnBlur("baseUrl", event.target.value)}
        />
        {config.baseUrl.startsWith("http://") && isLoopbackApiBaseUrl(config.baseUrl) ? <small className="settingWarning">{t("settings.api.httpWarning")}</small> : null}
        {!isDeepSeekOrigin(config.baseUrl) ? <small className="settingWarning">{t("settings.api.customHostWarning")}</small> : null}
      </SettingsField>

      {!config.thinkingMode && (
        <>
          <Slider
            id="temperatureSlider"
            label={t("settings.sampling.temperature")}
            value={config.temperature}
            min={0}
            max={2}
            step={0.05}
            onChange={(value) => updateConfig("temperature", value)}
            onBlur={(value) => saveOnBlur("temperature", value)}
          />
          <Slider
            id="topPSlider"
            label={t("settings.sampling.topP")}
            value={config.topP}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => updateConfig("topP", value)}
            onBlur={(value) => saveOnBlur("topP", value)}
          />
        </>
      )}

      <SettingsField htmlFor="maxTokensInput" label={t("settings.limits.maxTokens")}
        tooltip={t("settings.limits.maxTokensDescription")}>
        <NumberInput
          id="maxTokensInput"
          min={1}
          max={MAX_OUTPUT_TOKENS}
          step={1}
          value={config.maxTokens}
          onChange={(event) => updateBoundedInteger(event.currentTarget, 1, MAX_OUTPUT_TOKENS, (value) => updateConfig("maxTokens", value))}
          onBlur={(event) => updateBoundedInteger(event.currentTarget, 1, MAX_OUTPUT_TOKENS, (value) => saveOnBlur("maxTokens", value))}
        />
      </SettingsField>
    </SettingsGroup>
  );
}

export default AdvancedSection;

function updateBoundedInteger(input: HTMLInputElement, min: number, max: number, update: (value: number) => void): void {
  const value = input.valueAsNumber;
  if (Number.isInteger(value) && value >= min && value <= max) {update(value);}
}

function isDeepSeekOrigin(value: string): boolean {
  try {
    return getApiOrigin(value) === "https://api.deepseek.com";
  } catch {
    return false;
  }
}

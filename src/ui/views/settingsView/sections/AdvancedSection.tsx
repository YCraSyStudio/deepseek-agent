import { useState } from "react";
import "./AdvancedSection.css";
import { MAX_OUTPUT_TOKENS } from "@/contracts";
import { getApiOrigin, isLoopbackApiBaseUrl } from "@/shared/security/ApiOrigin";
import type { AdvancedSectionProps } from "../model";
import { SettingLabel, Slider } from "@webview/components/settingsView";
import { t } from "@webview/i18n";

function AdvancedSection({ config, updateConfig, saveOnBlur }: AdvancedSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="advancedSection">
      <h3 className="sectionTitle">
        <button
          type="button"
          className="collapsibleHeader"
          aria-expanded={!collapsed}
          aria-controls="advanced-settings-content"
          onClick={() => setCollapsed((current) => !current)}
        >
          {t("settings.advanced.title")}
          <span className={`chevron ${collapsed ? "collapsed" : ""}`} aria-hidden="true">
            <span className="codicon codicon-chevron-down" aria-hidden="true" />
          </span>
        </button>
      </h3>

      <div id="advanced-settings-content" className={`collapsibleContent ${collapsed ? "collapsed" : ""}`} hidden={collapsed}>
        <div className="settingRow">
          <label htmlFor="baseUrlInput">{t("settings.api.baseUrl")}</label>
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
        </div>

        {!config.thinkingMode && (
          <div className="settingRow">
            <Slider
              id="temperatureSlider"
              label={t("settings.sampling.temperature")}
              value={config.temperature}
              min={0}
              max={2}
              step={0.05}
              disabled={config.thinkingMode}
              onChange={(value) => updateConfig("temperature", value)}
              onBlur={(value) => saveOnBlur("temperature", value)}
            />
          </div>
        )}
        {!config.thinkingMode && (
          <div className="settingRow">
            <Slider
              id="topPSlider"
              label={t("settings.sampling.topP")}
              value={config.topP}
              min={0}
              max={1}
              step={0.05}
              disabled={config.thinkingMode}
              onChange={(value) => updateConfig("topP", value)}
              onBlur={(value) => saveOnBlur("topP", value)}
            />
          </div>
        )}

        <div className="tokenLimits">
          <div className="limitField">
            <SettingLabel htmlFor="maxTokensInput" label={t("settings.limits.maxTokens")} help={t("settings.limits.maxTokensDescription")} />
            <input
              id="maxTokensInput"
              type="number"
              min="1"
              max={MAX_OUTPUT_TOKENS}
              step="1"
              value={config.maxTokens}
              onChange={(event) => updateBoundedInteger(event.currentTarget, 1, MAX_OUTPUT_TOKENS, (value) => updateConfig("maxTokens", value))}
              onBlur={(event) => updateBoundedInteger(event.currentTarget, 1, MAX_OUTPUT_TOKENS, (value) => saveOnBlur("maxTokens", value))}
            />
          </div>
          <div className="limitField">
            <label htmlFor="maxConcurrentGenerationsInput">{t("settings.limits.maxConcurrentGenerations")}</label>
            <input
              id="maxConcurrentGenerationsInput"
              type="number"
              min={1}
              max={16}
              value={config.maxConcurrentGenerations}
              onChange={(event) => updateBoundedInteger(event.currentTarget, 1, 16, (value) => updateConfig("maxConcurrentGenerations", value))}
              onBlur={(event) => updateBoundedInteger(event.currentTarget, 1, 16, (value) => saveOnBlur("maxConcurrentGenerations", value))}
            />
          </div>
        </div>

      </div>
    </div>
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

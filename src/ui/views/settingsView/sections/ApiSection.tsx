import "./ApiSection.css";
import type { ApiSectionProps } from "../model";
import { SettingsField, SettingsInputAction, SettingsSection, Toggle } from "@webview/components/settingsView";
import { useApiConnectionState } from "./UseApiConnectionState";
import { t } from "@webview/i18n";

function ApiSection({ config, apiKeyDraft, credential, updateConfig, saveOnBlur, onApiKeyChange, onApiKeyBlur, modelOptions, reasoningEffortOptions, children }: ApiSectionProps) {
  const { apiKeyMessage, apiKeyPlaceholder, apiKeyStatus, apiKeyStatusClass, handleApiKeyBlur, handleApiKeyChange, handleDeleteApiKey, handleTestConnection, isDeleting, isTesting, showApiKey, toggleShowApiKey } =
    useApiConnectionState({
      config,
      apiKeyDraft,
      credential,
      onApiKeyChange,
      onApiKeyBlur,
    });

  return (
    <SettingsSection title={t("settings.api.title")} className="apiSection">

      <SettingsField htmlFor="apiKeyInput" label={t("settings.api.key")} layout="wide">
        <SettingsInputAction action={
          <button type="button" className="btn-icon apiKeyToggle" aria-label={t("settings.api.keyVisibility.label")} data-tooltip={t("settings.api.keyVisibility.tooltip")} data-tooltip-align="end" onClick={toggleShowApiKey}>
            {showApiKey ? <span className="codicon codicon-eye-closed" /> : <span className="codicon codicon-eye" />}
          </button>
        }>
          <input
            className={`apiKeyInput ${apiKeyStatusClass}`}
            id="apiKeyInput"
            type={showApiKey ? "text" : "password"}
            value={apiKeyDraft}
            placeholder={apiKeyPlaceholder}
            spellCheck={false}
            disabled={isDeleting}
            onChange={handleApiKeyChange}
            onBlur={handleApiKeyBlur}
          />
        </SettingsInputAction>

        <div className="statusRow">
          {apiKeyMessage ? <span className={`statusIndicator ${apiKeyStatusClass}`}>{apiKeyMessage}</span> : null}
          <div className="credentialActions">
            <button
              type="button"
              className="btn-secondary credentialDeleteButton"
              onClick={handleDeleteApiKey}
              disabled={isDeleting || isTesting || !!apiKeyDraft || credential?.status !== "configured"}
            >
              {t("settings.api.removeCredential")}
            </button>
            <button type="button" className="btn-secondary" onClick={handleTestConnection} disabled={isDeleting || isTesting || (apiKeyStatus !== "configured" && !apiKeyDraft)}>
              {t("settings.api.testConnection")}
            </button>
          </div>
        </div>
      </SettingsField>

      <SettingsField htmlFor="modelSelectSettings" label={t("settings.model.label")}>
        <select
          id="modelSelectSettings"
          value={config.model}
          onChange={(event) => {
            const model = event.target.value;
            if (!modelOptions.some((option) => option.value === model)) {return;}
            updateConfig("model", model);
            saveOnBlur("model", model);
          }}
        >
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingsField>

      <Toggle
        id="thinkingModeToggle"
        label={t("settings.reasoning.mode")}
        checked={config.thinkingMode}
        onToggle={(checked) => {
          updateConfig("thinkingMode", checked);
          saveOnBlur("thinkingMode", checked);
        }}
      />

      {config.thinkingMode && (
        <SettingsField htmlFor="reasoningEffort" label={t("settings.reasoning.effort")}>
          <select
            id="reasoningEffort"
            value={config.reasoningEffort}
            onChange={(event) => {
              const effort = reasoningEffortOptions.find((option) => option.value === event.target.value)?.value;
              if (!effort) {return;}
              updateConfig("reasoningEffort", effort);
              saveOnBlur("reasoningEffort", effort);
            }}
          >
            {reasoningEffortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </SettingsField>
      )}

      {children}
    </SettingsSection>
  );
}

export default ApiSection;

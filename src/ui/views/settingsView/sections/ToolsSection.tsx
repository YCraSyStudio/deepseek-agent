import { useMemo } from "react";
import type { PermissionMode } from "@/contracts";
import { NumberInput, SettingsField, SettingsGroup, SettingsSection, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import type { TranslationKey } from "@webview/i18n/I18n";
import type { ToolsSectionProps } from "../model";
import "./ToolsSection.css";

const PERMISSION_MODE_OPTIONS: Array<{ value: PermissionMode; label: TranslationKey; description: TranslationKey }> = [
  { value: "default", label: "tools.default", description: "tools.defaultDescription" },
  { value: "auto-approve", label: "tools.autoApprove", description: "tools.autoApproveModeDescription" },
  { value: "full-access", label: "tools.fullAccess", description: "tools.fullAccessDescription" },
];

function ToolsSection({ config, availableTools, updateConfig, saveOnBlur, permissionUpdatePending = false }: ToolsSectionProps) {
  const tools = useMemo(() => availableTools?.slice().sort((left, right) => left.name.localeCompare(right.name)) ?? [], [availableTools]);
  const permissionTooltip = PERMISSION_MODE_OPTIONS.map((option) => `**${t(option.label)}:** ${t(option.description)}`).join("\n\n");
  const updatePermissionMode = (permissionMode: PermissionMode) => {
    updateConfig("permissionMode", permissionMode);
    saveOnBlur("permissionMode", permissionMode);
  };

  return (
    <SettingsSection title={t("settings.tab.tools")} className="toolsSection">
      <SettingsGroup title={t("settings.toolCatalog.label")} collapsible defaultOpen={false}
        variant="panel" count={tools.length} busy={availableTools === null}>
        {availableTools === null || tools.length === 0 ? (
          <p className="settingsHint" role="status">
            {t(availableTools === null ? "settings.toolCatalog.loading" : "settings.toolCatalog.empty")}
          </p>
        ) : (
          <ul className="toolCatalogList">
            {tools.map((tool) => {
              const searchDisabled = !config.webSearchEnabled && (tool.name === "search_web" || tool.name === "read_web");
              const description = tool.description || t("settings.toolCatalog.noDescription");
              return (
                <li key={tool.name}>
                  <span
                    className={`toolCatalogItem${searchDisabled ? " toolCatalogUnavailable" : ""}`}
                    tabIndex={0}
                    data-tooltip={searchDisabled ? `${description}\n\n${t("settings.toolCatalog.searchDisabled")}` : description}
                    data-tooltip-position="bottom"
                    data-tooltip-align="start"
                  >
                    <code>{tool.name}</code>
                    <i className="codicon codicon-info" aria-hidden="true" />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsGroup>

      <SettingsField htmlFor="permissionMode" label={t("tools.permissionMode")}
        tooltip={permissionTooltip}>
        <select
          id="permissionMode"
          aria-label={t("tools.permissionMode")}
          value={config.permissionMode}
          disabled={permissionUpdatePending}
          aria-busy={permissionUpdatePending}
          onChange={(event) => {
            const permissionMode = parsePermissionMode(event.target.value);
            if (permissionMode) {updatePermissionMode(permissionMode);}
          }}
        >
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{t(option.label)}</option>
          ))}
        </select>
      </SettingsField>

      <SettingsField htmlFor="browserAccess" label={t("settings.browser.access")}>
        <select id="browserAccess" value={config.browserAccess} onChange={(event) => {
          const value = event.currentTarget.value as "ask" | "always" | "never";
          updateConfig("browserAccess", value); saveOnBlur("browserAccess", value);
        }}><option value="ask">{t("settings.browser.ask")}</option><option value="always">{t("settings.browser.always")}</option><option value="never">{t("settings.browser.never")}</option></select>
      </SettingsField>
      <Toggle id="automaticCaptureEnabled" label={t("settings.browser.automatic")}
        tooltip={t("settings.browser.automaticHelp")} checked={config.automaticCaptureEnabled} onToggle={(checked) => {
          updateConfig("automaticCaptureEnabled", checked); saveOnBlur("automaticCaptureEnabled", checked);
        }} />
      <SettingsField htmlFor="automaticCaptureLimit" label={t("settings.browser.limit")}>
        <NumberInput id="automaticCaptureLimit" min={1} max={40} value={config.automaticCaptureLimit} onChange={(event) => updateConfig("automaticCaptureLimit", Number(event.currentTarget.value))} onBlur={(event) => saveOnBlur("automaticCaptureLimit", Number(event.currentTarget.value))} />
      </SettingsField>
      <Toggle
        tooltip={t("settings.webSearch.description")}
        id="webSearchEnabled"
        label={t("settings.webSearch.title")}
        checked={config.webSearchEnabled}
        onToggle={(enabled) => {
          updateConfig("webSearchEnabled", enabled);
          saveOnBlur("webSearchEnabled", enabled);
        }}
      />
        <SettingsField htmlFor="webSearchRegion" label={t("settings.webSearch.region")} tooltip={t("settings.webSearch.regionHint")}>
        <select
          id="webSearchRegion"
          value={["global", "auto"].includes(config.webSearchRegion) ? config.webSearchRegion : "custom"}
          onChange={(event) => {
            const value = event.currentTarget.value === "custom" ? "" : event.currentTarget.value;
            updateConfig("webSearchRegion", value);
            if (value) {saveOnBlur("webSearchRegion", value);}
          }}
        >
          <option value="global">{t("settings.webSearch.global")}</option>
          <option value="auto">{t("settings.webSearch.auto")}</option>
          <option value="custom">{t("settings.webSearch.custom")}</option>
        </select>
        {!["global", "auto"].includes(config.webSearchRegion) ? (
          <input
            aria-label={t("settings.webSearch.countryCode")}
            placeholder="ES"
            data-tooltip={t("settings.webSearch.countryCode")}
            autoCapitalize="characters"
            spellCheck={false}
            value={config.webSearchRegion}
            maxLength={2}
            onChange={(event) => updateConfig("webSearchRegion", event.currentTarget.value.toUpperCase())}
            onBlur={(event) => saveOnBlur("webSearchRegion", event.currentTarget.value.trim() || "global")}
          />
        ) : null}
        </SettingsField>
    </SettingsSection>
  );
}

export default ToolsSection;

function parsePermissionMode(value: string): PermissionMode | undefined {
  return PERMISSION_MODE_OPTIONS.find((option) => option.value === value)?.value;
}

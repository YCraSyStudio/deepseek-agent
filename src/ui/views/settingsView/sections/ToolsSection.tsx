import type { PermissionMode } from "@/contracts";
import { SettingLabel, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import type { ToolsSectionProps } from "../model";
import "./ToolsSection.css";

function ToolsSection({ config, updateConfig, saveOnBlur, permissionUpdatePending = false }: ToolsSectionProps) {
  const permissionOptions: Array<{ value: PermissionMode; label: string; description: string }> = [
    { value: "default", label: t("tools.default"), description: t("tools.defaultDescription") },
    { value: "auto-approve", label: t("tools.autoApprove"), description: t("tools.autoApproveModeDescription") },
    { value: "full-access", label: t("tools.fullAccess"), description: t("tools.fullAccessDescription") },
  ];
  const selectedPermission = permissionOptions.find((option) => option.value === config.permissionMode) ?? permissionOptions[0];
  const updatePermissionMode = (permissionMode: PermissionMode) => {
    updateConfig("permissionMode", permissionMode);
    saveOnBlur("permissionMode", permissionMode);
  };

  return (
    <section className="settingsSection toolsSection">
      <h3 className="sectionTitle">{t("settings.tab.tools")}</h3>

      <div className="permissionModeRow">
        <SettingLabel htmlFor="permissionMode" label={t("tools.permissionMode")} help={selectedPermission.description} />
        <select
          id="permissionMode"
          className="permissionModeSelect"
          aria-label={t("tools.permissionMode")}
          value={config.permissionMode}
          disabled={permissionUpdatePending}
          aria-busy={permissionUpdatePending}
          onChange={(event) => {
            const permissionMode = parsePermissionMode(event.target.value);
            if (permissionMode) {updatePermissionMode(permissionMode);}
          }}
        >
          {permissionOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="settingRow">
        <label htmlFor="browserAccess">{t("settings.browser.access")}</label>
        <select id="browserAccess" value={config.browserAccess} onChange={(event) => {
          const value = event.currentTarget.value as "ask" | "always" | "never";
          updateConfig("browserAccess", value); saveOnBlur("browserAccess", value);
        }}><option value="ask">{t("settings.browser.ask")}</option><option value="always">{t("settings.browser.always")}</option><option value="never">{t("settings.browser.never")}</option></select>
      </div>
      <div className="settingRow">
        <Toggle id="automaticCaptureEnabled" label={t("settings.browser.automatic")} help={t("settings.browser.automaticHelp")} checked={config.automaticCaptureEnabled} onToggle={(checked) => {
          updateConfig("automaticCaptureEnabled", checked); saveOnBlur("automaticCaptureEnabled", checked);
        }} />
      </div>
      <div className="settingRow">
        <label htmlFor="automaticCaptureLimit">{t("settings.browser.limit")}</label>
        <input id="automaticCaptureLimit" type="number" min={1} max={40} value={config.automaticCaptureLimit} onChange={(event) => updateConfig("automaticCaptureLimit", Number(event.currentTarget.value))} onBlur={(event) => saveOnBlur("automaticCaptureLimit", Number(event.currentTarget.value))} />
      </div>
      <div className="webSearchSettings">
        <h4 className="subsectionTitle">{t("settings.webSearch.title")}</h4>
        <Toggle
          id="webSearchEnabled"
          label={t("settings.webSearch.enabled")}
          help={t("settings.webSearch.description")}
          checked={config.webSearchEnabled}
          onToggle={(enabled) => {
            updateConfig("webSearchEnabled", enabled);
            saveOnBlur("webSearchEnabled", enabled);
          }}
        />
        <SettingLabel htmlFor="webSearchRegion" label={t("settings.webSearch.region")} help={t("settings.webSearch.regionHint")} />
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
      </div>
    </section>
  );
}

export default ToolsSection;

function parsePermissionMode(value: string): PermissionMode | undefined {
  return value === "default" || value === "auto-approve" || value === "full-access" ? value : undefined;
}

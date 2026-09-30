import { useMemo, useState } from "react";
import type { PermissionMode } from "@/contracts";
import { Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import type { ToolsSectionProps } from "../model";
import "./ToolsSection.css";

const PERMISSION_MODE_OPTIONS: Array<{ value: PermissionMode; label: string; description: string }> = [
  { value: "default", label: t("tools.default"), description: t("tools.defaultDescription") },
  { value: "auto-approve", label: t("tools.autoApprove"), description: t("tools.autoApproveModeDescription") },
  { value: "full-access", label: t("tools.fullAccess"), description: t("tools.fullAccessDescription") },
];

function ToolsSection({ config, updateConfig, saveOnBlur, permissionUpdatePending = false }: ToolsSectionProps) {
  const [engineFilter, setEngineFilter] = useState("");
  const selectedPermission = PERMISSION_MODE_OPTIONS.find((option) => option.value === config.permissionMode) ?? PERMISSION_MODE_OPTIONS[0];
  const isAutomaticEngineSelection = config.searxngEngines.length === 0;
  const defaultEngines = useMemo(
    () => config.searxngEngineCatalog.filter((engine) => engine.enabled).map((engine) => engine.shortcut),
    [config.searxngEngineCatalog],
  );
  const effectiveSelectedEngines = useMemo(
    () => new Set(isAutomaticEngineSelection ? defaultEngines : config.searxngEngines),
    [config.searxngEngines, defaultEngines, isAutomaticEngineSelection],
  );
  const visibleEngines = useMemo(() => {
    const query = engineFilter.trim().toLowerCase();
    if (!query) {return config.searxngEngineCatalog;}
    return config.searxngEngineCatalog.filter((engine) =>
      engine.name.toLowerCase().includes(query) ||
      engine.shortcut.toLowerCase().includes(query) ||
      engine.categories.some((category) => category.toLowerCase().includes(query)));
  }, [config.searxngEngineCatalog, engineFilter]);

  const updatePermissionMode = (permissionMode: PermissionMode) => {
    updateConfig("permissionMode", permissionMode);
    saveOnBlur("permissionMode", permissionMode);
  };

  const updateEngines = (engines: string[]) => {
    updateConfig("searxngEngines", engines);
    saveOnBlur("searxngEngines", engines);
  };

  const toggleEngine = (shortcut: string, checked: boolean) => {
    const next = new Set(isAutomaticEngineSelection ? defaultEngines : config.searxngEngines);
    if (checked) {next.add(shortcut);} else {next.delete(shortcut);}
    updateEngines([...next]);
  };

  const engineSummary = isAutomaticEngineSelection
    ? t("settings.webSearch.enginesDefault")
    : `${config.searxngEngines.length} ${t("settings.webSearch.enginesSelected")}`;

  return (
    <section className="settingsSection toolsSection">
      <h3 className="sectionTitle">{t("settings.tab.tools")}</h3>

      <div className="permissionModeRow">
        <label className="permissionModeLabel" htmlFor="permissionMode">{t("tools.permissionMode")}</label>
        <select
          id="permissionMode"
          className="permissionModeSelect"
          aria-label={t("tools.permissionMode")}
          aria-describedby="permissionModeDescription"
          value={config.permissionMode}
          disabled={permissionUpdatePending}
          aria-busy={permissionUpdatePending}
          onChange={(event) => {
            const permissionMode = parsePermissionMode(event.target.value);
            if (permissionMode) {updatePermissionMode(permissionMode);}
          }}
        >
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <small id="permissionModeDescription" className="permissionModeDescription">{selectedPermission.description}</small>
      </div>

      <div className="settingRow">
        <label htmlFor="browserAccess">Browser capture access</label>
        <select id="browserAccess" value={config.browserAccess} onChange={(event) => {
          const value = event.currentTarget.value as "ask" | "always" | "never";
          updateConfig("browserAccess", value); saveOnBlur("browserAccess", value);
        }}><option value="ask">Ask per origin</option><option value="always">Always</option><option value="never">Never</option></select>
      </div>
      <div className="webSearchSettings">
        <h4 className="subsectionTitle">{t("settings.webSearch.title")}</h4>
        <p className="settingsHint">{t("settings.webSearch.description")}</p>
        <Toggle
          id="webSearchEnabled"
          label={t("settings.webSearch.enabled")}
          checked={config.webSearchEnabled}
          onToggle={(enabled) => {
            updateConfig("webSearchEnabled", enabled);
            saveOnBlur("webSearchEnabled", enabled);
          }}
        />

        <div className="settingRow searxngEndpointRow">
          <label htmlFor="searxngUrl">{t("settings.webSearch.searxngUrl")}</label>
          <input
            id="searxngUrl"
            type="url"
            spellCheck={false}
            value={config.searxngUrl}
            disabled={!config.webSearchEnabled}
            onChange={(event) => updateConfig("searxngUrl", event.currentTarget.value)}
            onBlur={(event) => saveOnBlur("searxngUrl", event.currentTarget.value)}
          />
          <small className="settingsHint">{t("settings.webSearch.searxngManagedHint")}</small>
        </div>

        <div className="settingRow searxngEnginesRow">
          <label>{t("settings.webSearch.engines")}</label>
          <details className="searxngEnginePicker">
            <summary className="searxngEnginePickerSummary" aria-label={t("settings.webSearch.engines")}>
              {engineSummary}
            </summary>
            <div className="searxngEnginePickerPanel">
              <div className="searxngEnginePickerToolbar">
                <input
                  type="search"
                  value={engineFilter}
                  disabled={!config.webSearchEnabled}
                  placeholder={t("settings.webSearch.filterEngines")}
                  aria-label={t("settings.webSearch.filterEngines")}
                  onChange={(event) => setEngineFilter(event.currentTarget.value)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!config.webSearchEnabled || isAutomaticEngineSelection}
                  onClick={() => updateEngines([])}
                >
                  {t("settings.webSearch.useDefaults")}
                </button>
              </div>

              {visibleEngines.length > 0 ? (
                <div className="searxngEngineList">
                  {visibleEngines.map((engine) => {
                    const toggleId = `searxng-engine-${engine.shortcut}`;
                    return (
                      <div className="searxngEngineOption" key={engine.shortcut}>
                        <label className="searxngEngineOptionText" htmlFor={toggleId}>
                          <span className="searxngEngineName" title={engine.name}>{engine.name}</span>
                          <span className="searxngEngineMeta">
                            !{engine.shortcut}
                            {engine.enabled ? ` · ${t("settings.webSearch.enabledByDefault")}` : ""}
                          </span>
                        </label>
                        <Toggle
                          id={toggleId}
                          checked={effectiveSelectedEngines.has(engine.shortcut)}
                          disabled={!config.webSearchEnabled}
                          onToggle={(checked) => toggleEngine(engine.shortcut, checked)}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="searxngEngineEmpty">{t("settings.webSearch.noEngines")}</div>
              )}
            </div>
          </details>
          <small className="settingsHint">{t("settings.webSearch.enginesHint")}</small>
        </div>
      </div>
    </section>
  );
}

export default ToolsSection;

function parsePermissionMode(value: string): PermissionMode | undefined {
  return PERMISSION_MODE_OPTIONS.find((option) => option.value === value)?.value;
}

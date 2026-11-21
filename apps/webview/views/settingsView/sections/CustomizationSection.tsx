import ReusableInstructionsSection from "./ReusableInstructionsSection";
import { SettingsField, SettingsGroup, SettingsSection, Toggle } from "@webview/components/settingsView";
import { t } from "@webview/i18n";
import type { CustomizationSectionProps } from "../model";

export default function CustomizationSection({ config, updateConfig, saveOnBlur, onOpenGlobalAgents, pending, workspaceRoots, workspaceRootUri, onWorkspaceRootChange, onOpenWorkspaceAgents, workspacePending, workspaceError }: CustomizationSectionProps) {
  const selectedRoot = workspaceRoots?.find((root) => root.uri === workspaceRootUri);
  return (
    <SettingsSection title={t("settings.tab.customization")}>
      <Toggle
        id="includeHomeAgents"
        label={t("settings.instructions.globalAgents")}
        tooltip={t("settings.customization.globalAgentsHelp")}
        checked={config.includeHomeAgents}
        disabled={pending}
        onToggle={(enabled) => {
          updateConfig("includeHomeAgents", enabled);
          saveOnBlur("includeHomeAgents", enabled);
        }}
      />
      {config.includeHomeAgents ? (
        <button type="button" className="btn-secondary" disabled={pending} aria-busy={pending} onClick={onOpenGlobalAgents}>
          <i className="codicon codicon-edit" aria-hidden="true" /> {t("settings.customization.openGlobalAgents")}
        </button>
      ) : null}

      <SettingsGroup title={t("settings.customization.workspaceTitle")}>
        {workspaceRoots && workspaceRoots.length > 1 ? (
          <SettingsField label={t("settings.customization.workspaceFolder")} htmlFor="workspaceInstructionsRoot" layout="wide">
            <select id="workspaceInstructionsRoot" value={workspaceRootUri} disabled={workspacePending}
              onChange={(event) => onWorkspaceRootChange(event.target.value)}>
              {workspaceRoots.map((root) => <option key={root.uri} value={root.uri}>{root.name}</option>)}
            </select>
          </SettingsField>
        ) : null}
        <button type="button" className="btn-secondary" disabled={!selectedRoot || workspacePending}
          aria-busy={workspacePending} onClick={onOpenWorkspaceAgents}>
          <i className={`codicon ${selectedRoot?.exists ? "codicon-edit" : "codicon-new-file"}`} aria-hidden="true" /> {t(selectedRoot?.exists ? "settings.customization.editWorkspaceAgents" : "settings.customization.generateWorkspaceAgents")}
        </button>
        {!workspaceRoots ? <p role="status">{t("settings.customization.workspaceLoading")}</p>
          : workspaceRoots.length === 0 && !workspaceError ? <p role="status">{t("settings.customization.workspaceUnavailable")}</p> : null}
        {workspaceError ? <p role="alert">{workspaceError}</p> : null}
      </SettingsGroup>
      <ReusableInstructionsSection roots={workspaceRoots} />
    </SettingsSection>
  );
}

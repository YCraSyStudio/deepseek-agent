import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import "@vscode/codicons/dist/codicon.css";
import "./SettingsView.css";
import { ApiTab } from "./tabs";
import { CustomizationSection, GeneralSection, ToolsSection } from "./sections";
import StorageSection from "./sections/StorageSection";
import { getVsCodeApi } from "../../VsCodeApi";
import { DEFAULT_CONFIG, MODEL_OPTIONS, REASONING_EFFORT_OPTIONS, type ApiCredentialState, type SaveOnBlurFn, type SettingsConfig } from "./model";
import type { AvailableToolInfo, HandlerToWebviewMessage } from "@/contracts";
import type { StorageInfo } from "@/contracts/Storage";
import { setInterfaceLanguage, t } from "@webview/i18n";
import { shouldApplyConfigRevision } from "@webview/config/ConfigRevision";

import type { WorkspaceInstructionsRoot } from "@/contracts/Customization";

type SettingsTab = "general" | "api" | "tools" | "customization";
type Notification = { type: "error" | "success"; message: string };

function SettingsView() {
  const vscode = useMemo(() => getVsCodeApi(), []);
  const [config, setConfig] = useState<SettingsConfig>(DEFAULT_CONFIG);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>();
  const [storagePending, setStoragePending] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const [availableTools, setAvailableTools] = useState<AvailableToolInfo[] | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiCredential, setApiCredential] = useState<ApiCredentialState | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [permissionUpdatePending, setPermissionUpdatePending] = useState(false);
  const [customizationPending, setCustomizationPending] = useState(false);
  const [workspaceRoots, setWorkspaceRoots] = useState<WorkspaceInstructionsRoot[] | null>(null);
  const [workspaceRootUri, setWorkspaceRootUri] = useState("");
  const [workspacePending, setWorkspacePending] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string>();
  const workspaceRequestRef = useRef<string | undefined>(undefined);
  const loadedRef = useRef(false);
  const revisionRef = useRef(-1);
  const pendingSecurityRequestsRef = useRef(new Set<string>());
  const pendingCustomizationRequestsRef = useRef(new Set<string>());
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({ general: null, api: null, tools: null, customization: null });

  const applyConfig = useCallback((nextConfig: Partial<SettingsConfig>) => {
    setConfig((current) => ({ ...current, ...nextConfig }));
  }, []);

  const updateConfig = useCallback(<K extends keyof SettingsConfig>(key: K, value: SettingsConfig[K]) => {
    if (key === "interfaceLanguage") {setInterfaceLanguage(value as SettingsConfig["interfaceLanguage"]);}
    setConfig((current) => ({ ...current, [key]: value }));
  }, []);

  const saveOnBlur = useCallback((
    keyOrPatch: keyof SettingsConfig | Partial<SettingsConfig>,
    value?: SettingsConfig[keyof SettingsConfig],
  ) => {
      const patch = typeof keyOrPatch === "string" ? { [keyOrPatch]: value } : keyOrPatch;
      const requestId = crypto.randomUUID();
      if (Object.prototype.hasOwnProperty.call(patch, "includeHomeAgents")) {
        pendingCustomizationRequestsRef.current.add(requestId);
        setCustomizationPending(true);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "permissionMode")) {
        pendingSecurityRequestsRef.current.add(requestId);
        setPermissionUpdatePending(true);
      }
      vscode?.postMessage({ type: "saveConfig", requestId, config: patch });
    },
    [vscode],
  ) as SaveOnBlurFn;

  const requestConfig = useCallback(() => {
    setLoadError(null);
    if (!loadedRef.current) {setHasLoadedConfig(false);}
    vscode?.postMessage({ type: "getConfig" });
  }, [vscode]);

  const selectTab = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
    tabRefs.current[tab]?.focus();
  }, []);

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const order: SettingsTab[] = ["general", "api", "tools", "customization"];
      const currentIndex = order.indexOf(activeTab);
      let nextTab: SettingsTab | undefined;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {nextTab = order[(currentIndex + 1) % order.length];}
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {nextTab = order[(currentIndex - 1 + order.length) % order.length];}
      if (event.key === "Home") {nextTab = order[0];}
      if (event.key === "End") {nextTab = order[order.length - 1];}
      if (!nextTab) {return;}
      event.preventDefault();
      selectTab(nextTab);
    },
    [activeTab, selectTab],
  );

  useEffect(() => {
    if (!vscode) {
      setLoadError(t("settings.unavailable"));
      return;
    }

    const handleMessage = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "configLoaded":
          if (!shouldApplyConfigRevision(revisionRef.current, message.revision)) {break;}
          revisionRef.current = message.revision;
          if (message.config.interfaceLanguage) {setInterfaceLanguage(message.config.interfaceLanguage);}
          applyConfig(message.config);
          if (message.storageInfo) {setStorageInfo(message.storageInfo);}
          loadedRef.current = true;
          setHasLoadedConfig(true);
          setLoadError(null);
          break;
        case "configUpdateResult":
          if (pendingCustomizationRequestsRef.current.delete(message.requestId)) {
            setCustomizationPending(pendingCustomizationRequestsRef.current.size > 0);
          }
          if (pendingSecurityRequestsRef.current.delete(message.requestId)) {
            setPermissionUpdatePending(pendingSecurityRequestsRef.current.size > 0);
          }
          if (shouldApplyConfigRevision(revisionRef.current, message.revision)) {
            revisionRef.current = message.revision;
            if (message.config.interfaceLanguage) {setInterfaceLanguage(message.config.interfaceLanguage);}
            applyConfig(message.config);
            if (message.storageInfo) {setStorageInfo(message.storageInfo);}
          }
          if (message.credentialUpdated) {
            setApiKeyDraft("");
            setApiCredential(null);
          }
          if (message.status === "success") {
            setNotification(message.operation === "reset"
              ? { type: "success", message: t("settings.reset.success") }
              : null);
          } else if (message.status === "error") {
            setNotification({ type: "error", message: t("settings.save.error") });
            if (!loadedRef.current) {setLoadError(t("settings.load.error"));}
          } else {
            setNotification(null);
          }
          break;
        case "apiKeyStatusSettings":
          setApiCredential({ status: message.status, keyPreview: message.keyPreview });
          break;
        case "storageDirectoryResult":
          setStorageInfo(message.storageInfo);
          setStoragePending(false);
          setStorageError(message.error);
          break;
        case "availableTools":
          setAvailableTools(message.tools);
          break;
        case "workspaceInstructions":
          setWorkspaceRoots(message.roots);
          setWorkspaceError(message.error);
          setWorkspaceRootUri((current) => message.roots.some((root) => root.uri === current) ? current
            : message.roots.find((root) => root.uri === message.preferredRootUri)?.uri ?? message.roots[0]?.uri ?? "");
          break;
        case "openWorkspaceInstructionsResult":
          if (message.requestId !== workspaceRequestRef.current) {break;}
          workspaceRequestRef.current = undefined;
          setWorkspacePending(false);
          setWorkspaceError(message.success ? undefined : `${t("settings.customization.workspaceOpenError")}${message.error ? ` ${message.error}` : ""}`);
          break;
        case "openGlobalAgentsResult":
          if (!pendingCustomizationRequestsRef.current.delete(message.requestId)) {break;}
          setCustomizationPending(pendingCustomizationRequestsRef.current.size > 0);
          if (!message.success) {
            setNotification({ type: "error", message: `${t("settings.customization.openError")}${message.error ? ` ${message.error}` : ""}` });
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    requestConfig();
    vscode.postMessage({ type: "getAvailableTools" });
    vscode.postMessage({ type: "getWorkspaceInstructions" });
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode, applyConfig, requestConfig]);

  return (
    <div className="settingsView">
      <div className="settingsTabs" role="tablist" aria-label={t("settings.tabs.label")}>
        <button
          type="button"
          className={`settingsTab ${activeTab === "general" ? "active" : ""}`}
          role="tab"
          id="settings-tab-general"
          aria-controls="settings-panel-general"
          aria-selected={activeTab === "general"}
          tabIndex={activeTab === "general" ? 0 : -1}
          ref={(element) => { tabRefs.current.general = element; }}
          onClick={() => selectTab("general")}
          onKeyDown={handleTabKeyDown}
        >
          {t("settings.tab.general")}
        </button>
        <button
          type="button"
          className={`settingsTab ${activeTab === "api" ? "active" : ""}`}
          role="tab"
          id="settings-tab-api"
          aria-controls="settings-panel-api"
          aria-selected={activeTab === "api"}
          tabIndex={activeTab === "api" ? 0 : -1}
          ref={(element) => { tabRefs.current.api = element; }}
          onClick={() => selectTab("api")}
          onKeyDown={handleTabKeyDown}
        >
          {t("settings.tab.api")}
        </button>
        <button
          type="button"
          className={`settingsTab ${activeTab === "tools" ? "active" : ""}`}
          role="tab"
          id="settings-tab-tools"
          aria-controls="settings-panel-tools"
          aria-selected={activeTab === "tools"}
          tabIndex={activeTab === "tools" ? 0 : -1}
          ref={(element) => { tabRefs.current.tools = element; }}
          onClick={() => selectTab("tools")}
          onKeyDown={handleTabKeyDown}
        >
          {t("settings.tab.tools")}
        </button>
        <button
          type="button"
          className={`settingsTab ${activeTab === "customization" ? "active" : ""}`}
          role="tab"
          id="settings-tab-customization"
          aria-controls="settings-panel-customization"
          aria-selected={activeTab === "customization"}
          tabIndex={activeTab === "customization" ? 0 : -1}
          ref={(element) => { tabRefs.current.customization = element; }}
          onClick={() => selectTab("customization")}
          onKeyDown={handleTabKeyDown}
        >
          {t("settings.tab.customization")}
        </button>
      </div>

      <div
        className="settingsTabPanel"
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
        tabIndex={0}
      >
        {!hasLoadedConfig && !loadError ? <div className="settingsState" role="status">{t("settings.loading")}</div> : null}
        {loadError ? (
          <div className="settingsState settingsError" role="alert">
            <span>{loadError}</span>
            <button type="button" className="btn-secondary" onClick={requestConfig}>{t("settings.retry")}</button>
          </div>
        ) : null}
        {hasLoadedConfig && activeTab === "general" ? (
          <GeneralSection config={config} updateConfig={updateConfig} saveOnBlur={saveOnBlur}>
            {storageInfo ? <StorageSection
              info={storageInfo}
              pending={storagePending}
              error={storageError}
              onSave={(directory) => {
                setStoragePending(true);
                setStorageError(undefined);
                vscode?.postMessage({ type: "setStorageDirectory", directory });
              }}
              onBrowse={() => {
                setStoragePending(true);
                setStorageError(undefined);
                vscode?.postMessage({ type: "selectStorageDirectory" });
              }}
              onReload={() => vscode?.postMessage({ type: "reloadStorage" })}
            /> : null}
          </GeneralSection>
        ) : null}
        {hasLoadedConfig && activeTab === "api" ? (
          <ApiTab
            config={config}
            apiKeyDraft={apiKeyDraft}
            credential={apiCredential}
            updateConfig={updateConfig}
            saveOnBlur={saveOnBlur}
            onApiKeyChange={setApiKeyDraft}
            onApiKeyBlur={(apiKey) => {
              const requestId = crypto.randomUUID();
              vscode?.postMessage({
                type: "saveConfig",
                requestId,
                config: { apiKey },
              });
            }}
            modelOptions={MODEL_OPTIONS}
            reasoningEffortOptions={REASONING_EFFORT_OPTIONS}
          />
        ) : null}
        {hasLoadedConfig && activeTab === "tools" ? (
          <ToolsSection
            config={config}
            availableTools={availableTools}
            updateConfig={updateConfig}
            saveOnBlur={saveOnBlur}
            permissionUpdatePending={permissionUpdatePending}
          />
        ) : null}
        {hasLoadedConfig && activeTab === "customization" ? (
          <CustomizationSection
            config={config}
            updateConfig={updateConfig}
            saveOnBlur={saveOnBlur}
            workspaceRoots={workspaceRoots}
            workspaceRootUri={workspaceRootUri}
            onWorkspaceRootChange={setWorkspaceRootUri}
            workspacePending={workspacePending}
            workspaceError={workspaceError}
            onOpenWorkspaceAgents={() => {
              if (!workspaceRootUri || workspacePending) {return;}
              const requestId = crypto.randomUUID();
              workspaceRequestRef.current = requestId;
              setWorkspacePending(true);
              setWorkspaceError(undefined);
              vscode?.postMessage({ type: "openWorkspaceInstructions", requestId, rootUri: workspaceRootUri });
            }}
            pending={customizationPending}
            onOpenGlobalAgents={() => {
              const requestId = crypto.randomUUID();
              pendingCustomizationRequestsRef.current.add(requestId);
              setCustomizationPending(true);
              vscode?.postMessage({ type: "openGlobalAgents", requestId });
            }}
          />
        ) : null}
      </div>

      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          const requestId = crypto.randomUUID();
          pendingSecurityRequestsRef.current.add(requestId);
          setPermissionUpdatePending(true);
          vscode?.postMessage({ type: "resetConfig", requestId });
        }}
        disabled={!hasLoadedConfig || permissionUpdatePending}
      >
        {t("settings.reset.label")}
      </button>
      {permissionUpdatePending ? <div className="settingsState" role="status" aria-live="polite">{t("chat.applyingPermissions")}</div> : null}

      {notification ? (
        <div className={`notification ${notification.type}`} role={notification.type === "error" ? "alert" : "status"}>
          <span>{notification.message}</span>
          <button type="button" className="btn-icon" aria-label={t("settings.notification.dismiss")} onClick={() => setNotification(null)}>
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default SettingsView;

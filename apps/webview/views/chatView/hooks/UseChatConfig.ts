import { useCallback, useEffect, useRef, useState } from "react";
import { useVsCode } from "../contexts";
import { MODEL_OPTIONS } from "@/contracts/deepseek/Models";
import { mapReasoningEffort, DEFAULT_REASONING_EFFORT, type HandlerToWebviewMessage, type PermissionMode, type ReasoningEffort } from "@/contracts";
import type { UsageCurrency } from "@/shared/usage/Usage";
import { shouldApplyConfigRevision } from "@webview/config/ConfigRevision";

function reasoningToConfig(value: string): { thinkingMode: boolean; reasoningEffort?: ReasoningEffort } {
  const thinkingMode = value !== "off";
  if (!thinkingMode) {
    return { thinkingMode };
  }
  return { thinkingMode, reasoningEffort: mapReasoningEffort(value) };
}

export function reasoningFromConfig(config: { thinkingMode?: boolean; reasoningEffort?: ReasoningEffort }): string {
  if (config.thinkingMode === false) {
    return "off";
  }
  return config.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
}

export function useChatConfig() {
  const vscode = useVsCode();

  const [reasoning, setReasoning] = useState<string>("high");
  const [selectedModel, setSelectedModel] = useState<string>(MODEL_OPTIONS[0]?.value ?? "");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [historyEnabled, setHistoryEnabled] = useState<boolean | undefined>(undefined);
  const [usageBreakdown, setUsageBreakdown] = useState(false);
  const [usageCostCurrency, setUsageCostCurrency] = useState<UsageCurrency>("usd");
  const [isPermissionUpdatePending, setPermissionUpdatePending] = useState(false);
  const [configUpdateError, setConfigUpdateError] = useState<string | null>(null);

  const selectedModelRef = useRef(selectedModel);
  const reasoningRef = useRef(reasoning);
  const revisionRef = useRef(-1);
  const pendingPermissionRequestRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);
  useEffect(() => {
    reasoningRef.current = reasoning;
  }, [reasoning]);
  const applySavedConfig = useCallback((config: { reasoning?: string; model?: string; permissionMode?: PermissionMode; historyEnabled?: boolean; usageBreakdown?: boolean; usageCostCurrency?: UsageCurrency }, revision?: number) => {
    if (revision !== undefined) {
      if (!shouldApplyConfigRevision(revisionRef.current, revision)) {
        return;
      }
      revisionRef.current = revision;
    }
    if (config.reasoning !== undefined) {
      setReasoning(config.reasoning);
      reasoningRef.current = config.reasoning;
    }
    if (config.model !== undefined) {
      setSelectedModel(config.model);
      selectedModelRef.current = config.model;
    }
    if (config.permissionMode !== undefined) {
      setPermissionMode(config.permissionMode);
    }
    if (config.historyEnabled !== undefined) {
      setHistoryEnabled(config.historyEnabled);
    }
    if (config.usageBreakdown !== undefined) {
      setUsageBreakdown(config.usageBreakdown);
    }
    if (config.usageCostCurrency !== undefined) {
      setUsageCostCurrency(config.usageCostCurrency);
    }
  }, []);
  const applyConfigUpdateResult = useCallback((message: Extract<HandlerToWebviewMessage, { type: "configUpdateResult" }>) => {
    applySavedConfig({
      reasoning: reasoningFromConfig(message.config),
      model: message.config.model,
      permissionMode: message.config.permissionMode,
      historyEnabled: message.config.historyEnabled,
      usageBreakdown: message.config.usageBreakdown,
      usageCostCurrency: message.config.usageCostCurrency,
    }, message.revision);
    if (pendingPermissionRequestRef.current === message.requestId) {
      pendingPermissionRequestRef.current = undefined;
      setPermissionUpdatePending(false);
      setConfigUpdateError(message.status === "error" ? (message.error ?? "Failed to apply permissions.") : null);
    }
  }, [applySavedConfig]);

  const handleReasoningChange = useCallback(
    (value: string) => {
      setReasoning(value);
      reasoningRef.current = value;
      const configUpdate = reasoningToConfig(value);
      vscode?.postMessage({ type: "saveConfig", requestId: crypto.randomUUID(), config: configUpdate });
    },
    [vscode],
  );

  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      selectedModelRef.current = modelId;
      vscode?.postMessage({ type: "selectModel", modelId });
      vscode?.postMessage({ type: "saveConfig", requestId: crypto.randomUUID(), config: { model: modelId } });
    },
    [vscode],
  );

  const handlePermissionModeChange = useCallback(
    (value: PermissionMode) => {
      const requestId = crypto.randomUUID();
      setPermissionMode(value);
      setConfigUpdateError(null);
      setPermissionUpdatePending(true);
      pendingPermissionRequestRef.current = requestId;
      vscode?.postMessage({ type: "saveConfig", requestId, config: { permissionMode: value } });
    },
    [vscode],
  );

  return {
    selectedModel,
    reasoning,
    permissionMode,
    historyEnabled,
    usageBreakdown,
    usageCostCurrency,
    isPermissionUpdatePending,
    configUpdateError,
    selectedModelRef,
    reasoningRef,
    applySavedConfig,
    applyConfigUpdateResult,
    handleReasoningChange,
    handleModelChange,
    handlePermissionModeChange,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent } from "react";
import { getVsCodeApi } from "@webview/VsCodeApi";
import type { ApiSectionProps } from "../model";
import { t } from "@webview/i18n";

type ApiSectionMessage =
  | { type: "connectionTestResult"; success: boolean; error?: string }
  | { type: "apiKeyDeleteResult"; requestId: string; status: "success" | "error" | "cancelled"; error?: string };

type ApiConnectionStateOptions = Pick<
  ApiSectionProps,
  "config" | "apiKeyDraft" | "credential" | "onApiKeyChange" | "onApiKeyBlur"
>;

export function useApiConnectionState({
  config,
  apiKeyDraft,
  credential,
  onApiKeyChange,
  onApiKeyBlur,
}: ApiConnectionStateOptions) {
  const vscode = useMemo(() => getVsCodeApi(), []);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lastTestResult, setLastTestResult] = useState<"success" | "failed" | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteRequestIdRef = useRef<string | undefined>(undefined);

  const apiKeyStatus = useMemo(() => {
    if (isTesting || isDeleting) {return "testing";}
    if (apiKeyDraft) {return "configured";}
    if (lastTestResult === "failed") {return "missing";}
    return credential?.status ?? "loading";
  }, [apiKeyDraft, credential?.status, isDeleting, isTesting, lastTestResult]);

  const apiKeyPlaceholder = credential?.status === "configured" && credential.keyPreview
    ? credential.keyPreview
    : "sk-...";

  const apiKeyMessage = useMemo(() => {
    if (isDeleting) {return t("settings.api.removingCredential");}
    if (isTesting) {return t("settings.api.testing");}
    if (deleteFailed) {return t("settings.api.removeCredentialFailed");}
    if (lastTestResult === "success") {return t("settings.api.connection.ok");}
    if (lastTestResult === "failed") {return t("settings.api.connection.failed");}
    if (!apiKeyDraft && credential?.status === "missing") {return t("settings.api.notConfigured");}
    return null;
  }, [apiKeyDraft, credential?.status, deleteFailed, isDeleting, isTesting, lastTestResult]);

  const resetTransientStatus = useCallback(() => {
    setIsTesting(false);
    setLastTestResult(null);
    setDeleteFailed(false);
  }, []);

  useEffect(() => {
    setIsTesting(false);
    setLastTestResult(null);
    setDeleteFailed(false);
  }, [credential?.keyPreview, credential?.status]);

  const handleTestConnection = useCallback(() => {
    if (!vscode) {
      return;
    }

    setIsTesting(true);
    setLastTestResult(null);
    vscode.postMessage({
      type: "testConnection",
      apiKey: apiKeyDraft || undefined,
      baseUrl: config.baseUrl,
      model: config.model,
    });
  }, [apiKeyDraft, config.baseUrl, config.model, vscode]);

  const handleDeleteApiKey = useCallback(() => {
    if (!vscode || isDeleting) {
      return;
    }
    const requestId = crypto.randomUUID();
    deleteRequestIdRef.current = requestId;
    setIsDeleting(true);
    setDeleteFailed(false);
    setLastTestResult(null);
    vscode.postMessage({ type: "deleteApiKey", requestId });
  }, [isDeleting, vscode]);

  const handleApiKeyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      resetTransientStatus();
      onApiKeyChange(event.target.value);
    },
    [onApiKeyChange, resetTransientStatus],
  );

  const handleApiKeyBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      onApiKeyBlur(event.target.value);
    },
    [onApiKeyBlur],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ApiSectionMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }

      if (message.type === "connectionTestResult") {
        setIsTesting(false);
        setLastTestResult(message.success ? "success" : "failed");
      }
      if (message.type === "apiKeyDeleteResult" && message.requestId === deleteRequestIdRef.current) {
        deleteRequestIdRef.current = undefined;
        setIsDeleting(false);
        setDeleteFailed(message.status === "error");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return {
    apiKeyMessage,
    apiKeyPlaceholder,
    apiKeyStatus,
    apiKeyStatusClass: apiKeyStatus === "configured" ? "statusConfigured" : apiKeyStatus === "testing" ? "statusTesting" : apiKeyStatus === "missing" ? "statusMissing" : "",
    handleApiKeyBlur,
    handleApiKeyChange,
    handleDeleteApiKey,
    handleTestConnection,
    isDeleting,
    isTesting,
    showApiKey,
    toggleShowApiKey: () => setShowApiKey((current) => !current),
  };
}

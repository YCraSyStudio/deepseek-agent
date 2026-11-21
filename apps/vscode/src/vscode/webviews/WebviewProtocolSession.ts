import * as vscode from "vscode";
import { WEBVIEW_PROTOCOL_VERSION, type WebviewToHandlerMessage } from "@/contracts";
import { logWarning } from "@/shared/logging/Logger";
import { isWebviewToHandlerMessage } from "./WebviewMessageValidation";

export function registerWebviewProtocol(
  webviewView: vscode.WebviewView,
  routeMessage: (message: WebviewToHandlerMessage) => void,
): vscode.Disposable {
  let protocolReady = false;
  return webviewView.webview.onDidReceiveMessage((message: unknown) => {
    if (!isWebviewToHandlerMessage(message)) {
      logWarning("[WebviewProvider] Ignoring malformed webview message");
      void webviewView.webview.postMessage({
        type: "requestRejected",
        requestId: getUnknownRequestId(message),
        action: getUnknownMessageType(message),
        error: "The request was rejected because its payload is invalid or exceeds a supported limit.",
      });
      return;
    }

    if (message.type === "initializeProtocol") {
      protocolReady = message.protocolVersion === WEBVIEW_PROTOCOL_VERSION;
      void webviewView.webview.postMessage(protocolReady
        ? { type: "protocolReady", protocolVersion: WEBVIEW_PROTOCOL_VERSION }
        : { type: "protocolError", supportedVersion: WEBVIEW_PROTOCOL_VERSION, error: "Unsupported webview protocol version." });
      return;
    }
    if (!protocolReady) {
      void webviewView.webview.postMessage({
        type: "requestRejected",
        requestId: getMessageRequestId(message),
        action: message.type,
        error: "The webview protocol has not been initialized. Reload the view and try again.",
      });
      return;
    }
    routeMessage(message);
  });
}

function getMessageRequestId(message: WebviewToHandlerMessage): string | undefined {
  if ("clientRequestId" in message) {
    return message.clientRequestId;
  }
  if ("requestId" in message) {
    return String(message.requestId);
  }
  return undefined;
}

function getUnknownRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { requestId?: unknown; clientRequestId?: unknown };
  const id = candidate.requestId ?? candidate.clientRequestId;
  return typeof id === "string" || typeof id === "number" ? String(id).slice(0, 512) : undefined;
}

function getUnknownMessageType(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type.slice(0, 128) : undefined;
}

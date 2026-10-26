import { useEffect, useState } from "react";
import type { VsCodeApi } from "@webview/VsCodeApi";
import type { CaptureScreenshotResult } from "@/contracts/Capture";

export function ScreenshotPreview({ id, conversationId, vscode }: { id: string; conversationId: string; vscode: VsCodeApi }) {
  const [preview, setPreview] = useState<{ uri?: string; metadata?: CaptureScreenshotResult; error?: string }>({});
  useEffect(() => {
    const requestId = crypto.randomUUID();
    setPreview({});
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "screenshotPreview" && data.requestId === requestId && data.conversationId === conversationId) {
        setPreview({ uri: data.uri, metadata: data.metadata, error: data.error });
      }
    };
    window.addEventListener("message", receive);
    const timer = setTimeout(() => setPreview((current) => current.uri || current.error ? current : { error: "Screenshot unavailable" }), 10000);
    vscode.postMessage({ type: "getScreenshotPreview", requestId, conversationId, screenshotId: id });
    return () => {clearTimeout(timer); window.removeEventListener("message", receive);};
  }, [id, conversationId, vscode]);
  return <figure className="screenshotPreview">
    {preview.uri ? <button type="button" aria-label="Open full screenshot" onClick={() => vscode.postMessage({ type: "openScreenshot", requestId: crypto.randomUUID(), conversationId, screenshotId: id })}>
      <img src={preview.uri} alt={preview.metadata?.target ?? id} loading="lazy" onError={() => setPreview({ error: "Screenshot was deleted or is unavailable" })} />
    </button> : <span role="status">{preview.error ?? "Loading screenshot…"}</span>}
    <figcaption>{preview.metadata ? `${preview.metadata.windowTitle ?? preview.metadata.target} · ${preview.metadata.width} × ${preview.metadata.height}` : id}</figcaption>
  </figure>;
}

import * as vscode from "vscode";
import { getCodiconFontFace, getNonce } from "./ViewRendererHelpers";

interface DevViewRendererOptions {
  webview: vscode.Webview;
  devServerUrl: string;
  codiconFontUri: vscode.Uri;
}

export function getDevViewContent(options: DevViewRendererOptions): string {
  const { webview, devServerUrl, codiconFontUri } = options;
  const nonce = getNonce();
  const codiconFontFace = getCodiconFontFace(codiconFontUri);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} ${devServerUrl} data:; font-src ${webview.cspSource} ${devServerUrl}; style-src ${webview.cspSource} ${devServerUrl} 'unsafe-inline'; script-src 'nonce-${nonce}' ${devServerUrl} 'unsafe-eval'; connect-src ${devServerUrl} ws://localhost:5175;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YCraSy DeepSeek Agent</title>
    ${codiconFontFace}
    <style>
      body {
        margin: 0;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
      }

      .dev-loading {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 24px;
        text-align: center;
      }

      .dev-loading p {
        margin: 0;
        color: var(--vscode-descriptionForeground);
      }

      .dev-loading pre {
        max-width: 720px;
        margin: 16px 0 0;
        overflow: auto;
        color: var(--vscode-errorForeground);
        text-align: left;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="dev-loading">
        <p>Starting webview dev server...</p>
      </div>
    </div>
    <script nonce="${nonce}" type="module">
      const devServerUrl = "${devServerUrl}";
      const root = document.getElementById("root");

      function showError(error) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        root.innerHTML = '<div class="dev-loading"><p>Could not load webview dev server.</p><pre></pre></div>';
        root.querySelector("pre").textContent = message;
      }

      async function loadWebview() {
        try {
          const RefreshRuntime = await import(devServerUrl + "/@react-refresh");
          RefreshRuntime.default.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;

          await import(devServerUrl + "/@vite/client");
          await import(devServerUrl + "/Main.tsx");
        } catch (error) {
          showError(error);
          window.setTimeout(loadWebview, 500);
        }
      }

      loadWebview();
    </script>
  </body>
</html>`;
}

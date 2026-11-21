import * as vscode from "vscode";
import { readFileSync } from "fs";
import { getNonce } from "./ViewRendererHelpers";

export function getHtmlContent(webview: vscode.Webview, webviewDistUri: vscode.Uri): string {
  const nonce = getNonce();
  const htmlPath = vscode.Uri.joinPath(webviewDistUri, "index.html");

  let html = readFileSync(htmlPath.fsPath, "utf-8");
  html = html.replace(/(src|href)="(\.?\/?assets\/[^"]+)"/g, (_match: string, attr: string, assetPath: string) => {
    const cleanPath = assetPath.replace(/^[\.\/]+/, "");
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, cleanPath));
    return `${attr}="${uri}"`;
  });
  html = html.replace(/<script/g, `<script nonce="${nonce}"`);
  html = html.replace(/{{CSP_SOURCE}}/g, webview.cspSource);
  html = html.replace(/{{NONCE}}/g, nonce);
  return html;
}

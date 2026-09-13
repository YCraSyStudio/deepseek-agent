import * as vscode from "vscode";

export function getCodiconFontFace(codiconFontUri: vscode.Uri, nonce?: string): string {
  const nonceAttribute = nonce ? ` nonce="${nonce}"` : "";
  return `<style${nonceAttribute}>
@font-face {
  font-family: "codicon";
  font-display: block;
  src: url("${codiconFontUri}") format("truetype");
}
</style>`;
}

export function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 64; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

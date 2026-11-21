import { useCallback } from "react";
import type { VsCodeApi } from "@webview/VsCodeApi";
import type { CodeAction } from "../../views/chatView/ChatViewTypes";

export function useCodeActionHandler(vscode: VsCodeApi | null) {
  return useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!vscode) {return;}

      const target = event.target as HTMLElement;
      const actionButton = target.closest<HTMLButtonElement>("[data-code-action]");
      if (!actionButton) {return;}

      const codeBlock = actionButton.closest(".code-block");
      const code = codeBlock?.getAttribute("data-code-text") || codeBlock?.querySelector("code")?.textContent || "";
      const action = actionButton.dataset.codeAction as CodeAction | undefined;
      if (!code || !action) {return;}

      if (action === "copy") {vscode.postMessage({ type: "copyCode", code });}
      if (action === "insert") {vscode.postMessage({ type: "insertCode", code });}
    },
    [vscode],
  );
}

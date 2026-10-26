import { useCallback, type ClipboardEvent, type KeyboardEvent } from "react";
import type { VsCodeApi } from "@webview/VsCodeApi";

function selectedText(root: HTMLElement): string {
  const focused = document.activeElement;
  if ((focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) && root.contains(focused)) {
    if (focused.selectionStart !== null && focused.selectionEnd !== null) {
      return focused.value.slice(focused.selectionStart, focused.selectionEnd);
    }
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode ||
    !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {return "";}
  return selection.toString();
}

/** Route chat copies through VS Code's clipboard, including remote webviews. */
export function useChatClipboard(vscode: VsCodeApi | null) {
  const onCopyCapture = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const text = selectedText(event.currentTarget);
    if (!text || !vscode || text.length > 2 * 1024 * 1024) {return;}
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    vscode.postMessage({ type: "copyCode", code: text });
  }, [vscode]);
  const onKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") {return;}
    const text = selectedText(event.currentTarget);
    if (!text || !vscode || text.length > 2 * 1024 * 1024) {return;}
    event.preventDefault();
    vscode.postMessage({ type: "copyCode", code: text });
  }, [vscode]);
  return { onCopyCapture, onKeyDownCapture };
}

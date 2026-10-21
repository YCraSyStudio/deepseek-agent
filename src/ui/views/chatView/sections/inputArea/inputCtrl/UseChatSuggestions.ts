import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { HandlerToWebviewMessage } from "@/contracts";
import type { VsCodeApi } from "@webview/VsCodeApi";

export function useChatSuggestions(input: string, setInput: (value: string) => void,
  textarea: RefObject<HTMLTextAreaElement | null>, vscode: VsCodeApi | null, blocked: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [credentialReady, setCredentialReady] = useState(false);
  const [revision, setRevision] = useState(-1);
  const revisionRef = useRef(-1);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [dismissed, setDismissed] = useState<string>();
  const [suggestion, setSuggestion] = useState("");
  const suggestionPrefix = useRef("");
  const reset = useCallback(() => setSuggestion(""), []);

  useEffect(() => {
    const receive = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (message.type === "apiKeyStatus") {setCredentialReady(message.status === "configured");}
      if (message.type !== "configLoaded" && message.type !== "configUpdateResult") {return;}
      if (message.revision < revisionRef.current) {return;}
      revisionRef.current = message.revision;
      setRevision(message.revision);
      setEnabled(message.config.betaFeaturesEnabled === true && message.config.chatSuggestionsEnabled === true);
      reset();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [reset]);

  useEffect(() => {
    reset();
    if (!enabled || !credentialReady || !focused || composing || !atEnd || blocked || !vscode ||
      input === dismissed || input.trim().length < 4 || input.length > 12_000 || input.trimStart().startsWith("/")) {return;}
    const requestId = crypto.randomUUID();
    let sent = false;
    const timer = setTimeout(() => {
      const node = textarea.current;
      if (!node || document.activeElement !== node || node.selectionStart !== input.length || node.selectionEnd !== input.length) {return;}
      sent = true;
      vscode.postMessage({ type: "getChatSuggestion", requestId, prefix: input });
    }, 800);
    const receive = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      const node = textarea.current;
      if (message.type !== "chatSuggestion" || message.requestId !== requestId || !node ||
        document.activeElement !== node || node.value !== input || node.selectionStart !== input.length || node.selectionEnd !== input.length) {return;}
      suggestionPrefix.current = input;
      setSuggestion(message.text.slice(0, 400));
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (sent) {vscode.postMessage({ type: "cancelChatSuggestion", requestId });}
    };
  }, [input, enabled, credentialReady, focused, composing, atEnd, blocked, vscode, dismissed, revision, textarea, reset]);

  const cursorChanged = useCallback(() => {
    const node = textarea.current;
    setAtEnd(Boolean(node && node.selectionStart === node.value.length && node.selectionEnd === node.value.length));
    reset();
  }, [reset, textarea]);
  const dismiss = useCallback(() => {setDismissed(input); reset();}, [input, reset]);
  const accept = useCallback(() => {
    if (!suggestion || suggestionPrefix.current !== input || !enabled || !focused || !atEnd || composing) {return false;}
    setInput(input + suggestion);
    reset();
    return true;
  }, [suggestion, enabled, focused, atEnd, composing, input, setInput, reset]);

  return { suggestion: suggestionPrefix.current === input && focused && atEnd && !blocked && !composing ? suggestion : "", accept, dismiss, cursorChanged,
    onFocus: () => {setFocused(true); cursorChanged();}, onBlur: () => {setFocused(false); reset();},
    onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) };
}

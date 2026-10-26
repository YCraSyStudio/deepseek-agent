import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { HandlerToWebviewMessage } from "@/contracts";
import type { VsCodeApi } from "@webview/VsCodeApi";

export type ChatSuggestionControls = {
  visible: boolean;
  disabled: boolean;
  pending: boolean;
  request: () => void;
  cancel: () => void;
};

export function useChatSuggestions(input: string, setInput: (value: string) => void,
  textarea: RefObject<HTMLTextAreaElement | null>, vscode: VsCodeApi | null, blocked: boolean, scope?: string) {
  const [enabled, setEnabled] = useState(false);
  const [credentialReady, setCredentialReady] = useState(false);
  const [revision, setRevision] = useState(-1);
  const revisionRef = useRef(-1);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const active = useRef<{ requestId: string; prefix: string } | undefined>(undefined);
  const suggestionPrefix = useRef("");
  const cancel = useCallback(() => {
    if (active.current) {vscode?.postMessage({ type: "cancelChatSuggestion", requestId: active.current.requestId });}
    active.current = undefined;
    setPending(false);
    setSuggestion("");
    setUnavailable(false);
  }, [vscode]);

  useEffect(() => {
    const receive = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (message.type === "apiKeyStatus") {setCredentialReady(message.status === "configured");}
      if (message.type === "configLoaded" || message.type === "configUpdateResult") {
        if (message.revision < revisionRef.current) {return;}
        revisionRef.current = message.revision;
        setRevision(message.revision);
        setEnabled(message.config.betaFeaturesEnabled === true && message.config.chatSuggestionsEnabled === true);
        cancel();
      }
      if (message.type !== "chatSuggestion" || message.requestId !== active.current?.requestId) {return;}
      const prefix = active.current.prefix;
      active.current = undefined;
      setPending(false);
      const node = textarea.current;
      if (!node || document.activeElement !== node || node.value !== prefix ||
        node.selectionStart !== prefix.length || node.selectionEnd !== prefix.length) {return;}
      suggestionPrefix.current = prefix;
      setSuggestion(message.text.slice(0, 400));
      setUnavailable(!message.text);
    };
    window.addEventListener("message", receive);
    return () => {window.removeEventListener("message", receive); cancel();};
  }, [cancel, textarea]);

  // Editing, disabling suggestions or changing context cancels the explicit request.
  useEffect(() => {cancel();}, [input, enabled, credentialReady, blocked, revision, composing, scope, cancel]);

  const disabled = !enabled || !credentialReady || composing || blocked || !vscode || input.length > 12_000;
  const request = useCallback(() => {
    if (disabled) {return;}
    const node = textarea.current;
    if (!node) {return;}
    cancel();
    node.focus();
    node.setSelectionRange(input.length, input.length);
    setFocused(true);
    setAtEnd(true);
    const requestId = crypto.randomUUID();
    active.current = { requestId, prefix: input };
    setPending(true);
    vscode!.postMessage({ type: "getChatSuggestion", requestId, prefix: input });
  }, [disabled, input, textarea, vscode, cancel]);

  const cursorChanged = useCallback(() => {
    const node = textarea.current;
    const end = Boolean(node && node.selectionStart === node.value.length && node.selectionEnd === node.value.length);
    setAtEnd(end);
    if (!end) {cancel();}
  }, [cancel, textarea]);
  const accept = useCallback(() => {
    if (!suggestion || suggestionPrefix.current !== input || !enabled || !focused || !atEnd || composing) {return false;}
    setInput(input + suggestion);
    cancel();
    return true;
  }, [suggestion, enabled, focused, atEnd, composing, input, setInput, cancel]);

  return { suggestion: suggestionPrefix.current === input && focused && atEnd && !blocked && !composing ? suggestion : "",
    controls: { visible: enabled, disabled, pending, request, cancel } satisfies ChatSuggestionControls,
    unavailable, accept, dismiss: cancel, cursorChanged,
    onFocus: () => {setFocused(true); cursorChanged();}, onBlur: () => {setFocused(false); cancel();},
    onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) };
}

import { orderPathCompletions } from "@webview/components/chatView/fileSelector/CompletionGroups";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { HandlerToWebviewMessage, PathCompletionItem } from "@/contracts";
import { getPathToken, type PathToken } from "@webview/components/chatView";
import type { VsCodeApi } from "@webview/VsCodeApi";

interface UsePathCompletionsOptions {
  conversationId?: string;
  input: string;
  setInput: (input: string) => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  vscode: VsCodeApi | null;
  workspaceRevision?: string;
}

export function usePathCompletions({
  conversationId,
  input,
  setInput,
  textareaRef,
  vscode,
  workspaceRevision,
}: UsePathCompletionsOptions) {
  const requestIdRef = useRef(0);
  const activeRequestIdRef = useRef(0);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCompletionQueryRef = useRef<string | null>(null);
  const [pathToken, setPathToken] = useState<PathToken | null>(null);
  const [completions, setCompletions] = useState<PathCompletionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasCompletionResponse, setHasCompletionResponse] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (
        message.type !== "pathCompletions" ||
        message.requestId !== activeRequestIdRef.current ||
        (workspaceRevision && message.workspaceRevision !== workspaceRevision)
      ) {
        return;
      }
      const uniqueItems = message.items.filter(
        (item, index, items) => items.findIndex(
          (candidate) => candidate.path === item.path && candidate.type === item.type,
        ) === index,
      );
      setCompletions(orderPathCompletions(uniqueItems));
      setActiveIndex(0);
      setHasCompletionResponse(true);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [workspaceRevision]);

  useEffect(() => () => {
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
    }
  }, []);

  const requestPathCompletions = useCallback(
    (value: string, cursor: number, immediate = false) => {
      const token = getPathToken(value, cursor);
      setPathToken(token);

      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      if (!token || !vscode) {
        setCompletions([]);
        setHasCompletionResponse(false);
        lastCompletionQueryRef.current = null;
        activeRequestIdRef.current = requestIdRef.current + 1;
        requestIdRef.current = activeRequestIdRef.current;
        return;
      }
      if (lastCompletionQueryRef.current === token.query) {
        return;
      }

      lastCompletionQueryRef.current = token.query;
      setCompletions([]);
      setHasCompletionResponse(false);
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      activeRequestIdRef.current = requestId;
      const sendRequest = () => {
        vscode.postMessage({
          type: "getPathCompletions",
          requestId,
          query: token.query,
          conversationId,
          workspaceRevision,
        });
      };

      if (immediate) {
        sendRequest();
      } else {
        completionTimerRef.current = setTimeout(sendRequest, 140);
      }
    },
    [vscode, conversationId, workspaceRevision],
  );

  const clearCompletions = useCallback(() => {
    if (completionTimerRef.current) {clearTimeout(completionTimerRef.current);completionTimerRef.current = null;}
    activeRequestIdRef.current = ++requestIdRef.current;
    lastCompletionQueryRef.current = null;
    setHasCompletionResponse(false);
    setCompletions([]);
    setPathToken(null);
  }, []);

  useEffect(() => {clearCompletions();}, [clearCompletions, conversationId, workspaceRevision]);

  const insertCompletion = useCallback(
    (completion: PathCompletionItem) => {
      if (!pathToken) {
        return;
      }
      const textarea = textareaRef.current;
      const inserted = completion.type === "instruction" ? `${completion.path} ` : completion.path;
      const nextInput = `${input.slice(0, pathToken.start)}${inserted}${input.slice(pathToken.end)}`;
      const cursor = pathToken.start + inserted.length;
      setInput(nextInput);
      if (completion.type === "directory") {
        lastCompletionQueryRef.current = null;
        requestPathCompletions(nextInput, cursor, true);
      } else {
        clearCompletions();
      }

      requestAnimationFrame(() => {
        if (!textarea) {
          return;
        }
        textarea.selectionStart = cursor;
        textarea.selectionEnd = cursor;
        textarea.focus();
      });
    },
    [clearCompletions, input, pathToken, requestPathCompletions, setInput, textareaRef],
  );

  return {
    activeIndex,
    clearCompletions,
    completions,
    hasCompletionResponse,
    insertCompletion,
    pathToken,
    requestPathCompletions,
    setActiveIndex,
  };
}

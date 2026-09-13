import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { WEBVIEW_INPUT_LIMITS, type ImageAttachment, type ReferencedFile } from "@/contracts";
import "./InputCtrl.css";
import { FileSelector } from "@webview/components/chatView";
import ImageLightbox, { type LightboxImage } from "@webview/components/shared/imageLightbox/ImageLightbox";
import { useVsCode } from "@webview/views/chatView/contexts";
import { t } from "@webview/i18n";
import { usePathCompletions } from "./UsePathCompletions";

type Props = {
  input: string;
  setInput: (input: string) => void;
  isProcessing?: boolean;
  canSend?: boolean;
  selectedModelRef: { current: string };
  reasoningRef: { current: string };
  placeholder?: string;
  rows?: number;
  referencedFiles?: ReferencedFile[];
  imageAttachments?: ImageAttachment[];
  onRemoveImageAttachment?: (attachment: ImageAttachment) => void;
  onImagePasteError?: (error: string) => void;
  conversationId?: string;
  workspaceRevision?: string;
  activeGenerationId?: string;
  onSend?: (text: string, clientRequestId: string) => void;
  footer?: React.ReactNode;
};

const InputCtrl = forwardRef<HTMLTextAreaElement, Props>(
  (
    {
      input,
      setInput,
      isProcessing = false,
      canSend = true,
      selectedModelRef,
      reasoningRef,
      placeholder = "Type your message here...",
      rows = 1,
      referencedFiles,
      imageAttachments = [],
      onRemoveImageAttachment,
      onImagePasteError,
      conversationId,
      workspaceRevision,
      activeGenerationId,
      onSend,
      footer,
    },
    ref,
  ) => {
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const vscode = useVsCode();
    const [isControlPressed, setIsControlPressed] = useState(false);
    const [enlargedImage, setEnlargedImage] = useState<LightboxImage | null>(null);
    const hasTextContent = input.trim().length > 0;
    const {
      activeIndex,
      clearCompletions,
      completions,
      hasCompletionResponse,
      insertCompletion,
      pathToken,
      requestPathCompletions,
      setActiveIndex,
    } = usePathCompletions({
      conversationId,
      input,
      setInput,
      textareaRef: taRef,
      vscode,
      workspaceRevision,
    });

    useImperativeHandle(ref, () => taRef.current!, [taRef]);

    useEffect(() => {
      const handleModifierChange = (event: KeyboardEvent) => setIsControlPressed(event.ctrlKey);
      const handleWindowBlur = () => setIsControlPressed(false);
      window.addEventListener("keydown", handleModifierChange);
      window.addEventListener("keyup", handleModifierChange);
      window.addEventListener("blur", handleWindowBlur);
      return () => {
        window.removeEventListener("keydown", handleModifierChange);
        window.removeEventListener("keyup", handleModifierChange);
        window.removeEventListener("blur", handleWindowBlur);
      };
    }, []);

    const handleSend = useCallback(() => {
      const text = input.trim();
      if ((!text && imageAttachments.length === 0) || !vscode || !canSend) {
        return;
      }

      clearCompletions();
      const clientRequestId = crypto.randomUUID();
      onSend?.(text, clientRequestId);
      vscode.postMessage({
        type: "sendMessage",
        clientRequestId,
        text,
        modelId: selectedModelRef.current,
        reasoning: reasoningRef.current,
        conversationId,
        workspaceRevision,
        referencedFiles: referencedFiles?.map(toRequestReference),
        imageAttachments,
      });
    }, [input, imageAttachments, vscode, canSend, clearCompletions, selectedModelRef, reasoningRef, referencedFiles, conversationId, workspaceRevision, onSend]);

    const handleCancel = useCallback(() => {
      if (activeGenerationId && conversationId) {
        vscode?.postMessage({
          type: "cancelGeneration",
          requestId: crypto.randomUUID(),
          generationId: activeGenerationId,
          conversationId,
        });
      }
    }, [vscode, activeGenerationId, conversationId]);

    const handleSteer = useCallback(() => {
      const text = input.trim();
      if ((!text && imageAttachments.length === 0) || !vscode || !conversationId || !activeGenerationId) {
        return;
      }
      const clientRequestId = crypto.randomUUID();
      onSend?.(text, clientRequestId);
      vscode.postMessage({
        type: "steerGeneration",
        generationId: activeGenerationId,
        clientRequestId,
        text,
        modelId: selectedModelRef.current,
        reasoning: reasoningRef.current,
        conversationId,
        workspaceRevision,
        referencedFiles: referencedFiles?.map(toRequestReference),
        imageAttachments,
      });
    }, [activeGenerationId, conversationId, imageAttachments, input, onSend, reasoningRef, referencedFiles, selectedModelRef, vscode, workspaceRevision]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (completions.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((index) => (index + 1) % completions.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((index) => (index - 1 + completions.length) % completions.length);
            return;
          }
          if (e.key === "Tab" || e.key === "Enter") {
            e.preventDefault();
            insertCompletion(completions[activeIndex]);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            clearCompletions();
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey && canSend) {
          e.preventDefault();
          if (!isProcessing) {
            handleSend();
          } else if (e.ctrlKey) {
            handleSend();
          } else {
            handleSteer();
          }
        }
      },
      [activeIndex, canSend, clearCompletions, completions, handleSend, handleSteer, insertCompletion, isProcessing, setActiveIndex],
    );

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        requestPathCompletions(e.target.value, e.target.selectionStart);
      },
      [requestPathCompletions, setInput],
    );

    const handleCursorChange = useCallback(() => {
      const textarea = taRef.current;
      if (textarea) {
        requestPathCompletions(input, textarea.selectionStart);
      }
    }, [input, requestPathCompletions]);

    const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const images = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .flatMap((item) => item.getAsFile() ? [item.getAsFile()!] : []);
      if (images.length === 0) {return;}
      event.preventDefault();
      if (imageAttachments.length + images.length > WEBVIEW_INPUT_LIMITS.images) {
        onImagePasteError?.(`You can attach at most ${WEBVIEW_INPUT_LIMITS.images} images.`);
        return;
      }
      for (const [index, file] of images.entries()) {
        if (file.size < 1 || file.size > WEBVIEW_INPUT_LIMITS.clipboardImageBytes) {
          onImagePasteError?.("A pasted image may be at most 16 MiB. Use the attachment picker for larger images.");
          continue;
        }
        void file.arrayBuffer().then((buffer) => {
          vscode?.postMessage({
            type: "uploadClipboardImage",
            requestId: crypto.randomUUID(),
            name: file.name || `pasted-image-${Date.now()}-${index + 1}.${extensionForMime(file.type)}`,
            mediaType: file.type,
            size: file.size,
            dataBase64: bytesToBase64(new Uint8Array(buffer)),
          });
        }, () => onImagePasteError?.("The pasted image could not be read."));
      }
    }, [imageAttachments.length, onImagePasteError, vscode]);

    return (
      <div className="inputComposer">
        {imageAttachments.length > 0 ? (
          <div className="composerImageAttachments">
            {imageAttachments.map((attachment) => {
              const previewUri = attachment.previewUri;
              return (
                <div className="composerImageAttachment" key={attachment.id} title={attachment.name}>
                  {previewUri
                    ? (
                      <button
                        type="button"
                        className="composerImagePreview"
                        onClick={() => setEnlargedImage({ id: attachment.id, src: previewUri, name: attachment.name })}
                        aria-label={t("chat.enlargeImage", { name: attachment.name })}
                      >
                        <img src={previewUri} alt={attachment.name} />
                      </button>
                    )
                    : <span className="codicon codicon-file-media" aria-hidden="true" />}
                  <button
                    type="button"
                    className="composerImageRemove"
                    onClick={() => onRemoveImageAttachment?.(attachment)}
                    aria-label={t("chat.removeImage")}
                  >
                    <span className="codicon codicon-close" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="inputCtrl">
          <FileSelector
            activeIndex={activeIndex}
            completions={completions}
            isOpen={Boolean(pathToken) && hasCompletionResponse}
            onSelect={insertCompletion}
            listboxId="path-completion-listbox"
          />

          <span className="srOnly" role="status" aria-live="polite">
            {pathToken && hasCompletionResponse
              ? completions.length > 0
                ? t("chat.pathSuggestionCount", { count: completions.length })
                : t("chat.noFilesOrFoldersFound")
              : ""}
          </span>

          <textarea
            ref={taRef}
            className="Input"
            placeholder={placeholder}
            value={input}
            onChange={handleChange}
            onClick={handleCursorChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={rows}
            aria-label={t("chat.chatMessage")}
            aria-autocomplete="list"
            aria-expanded={completions.length > 0 && Boolean(pathToken)}
            aria-controls={completions.length > 0 ? "path-completion-listbox" : undefined}
            aria-activedescendant={completions.length > 0 ? `path-completion-option-${activeIndex}` : undefined}
            aria-busy={isProcessing}
            maxLength={WEBVIEW_INPUT_LIMITS.chatText}
          />
        </div>
        <div className="inputComposerFooter">
          {footer}
          <div className="inputComposerActions">
            {isProcessing ? (
              <button
                className={`${hasTextContent ? "sendBtn" : "stopBtn"} inside`}
                type="button"
                onClick={(event) => {
                  if (!hasTextContent) {
                    handleCancel();
                  } else if (event.ctrlKey || isControlPressed) {
                    handleSend();
                  } else {
                    handleSteer();
                  }
                }}
                disabled={hasTextContent && !canSend}
                aria-label={t(!hasTextContent ? "chat.stopGeneration" : isControlPressed ? "chat.queueMessage" : "chat.interruptAndGuide")}
                data-tooltip={t(!hasTextContent ? "chat.stopGeneration" : isControlPressed ? "chat.queueMessage" : "chat.interruptAndGuide")}
                data-tooltip-align="end"
              >
                <span
                  className={`codicon ${!hasTextContent ? "codicon-debug-stop" : isControlPressed ? "codicon-list-ordered" : "codicon-debug-restart"}`}
                  aria-hidden="true"
                />
              </button>
            ) : (
              <button className="sendBtn inside" type="button" onClick={handleSend} disabled={!canSend} aria-label={t("chat.sendMessage")} data-tooltip={t("chat.sendMessage")} data-tooltip-align="end">
                <span className="codicon codicon-send" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <ImageLightbox image={enlargedImage} onClose={() => setEnlargedImage(null)} />
      </div>
    );
  },
);

export default InputCtrl;

function toRequestReference(file: ReferencedFile) {
  return {
    path: file.path,
    content: file.content,
    type: file.type,
    referenceId: file.referenceId,
    scope: file.scope,
    rootUri: file.rootUri,
    bindingRevision: file.bindingRevision,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))));
  }
  return btoa(chunks.join(""));
}

function extensionForMime(mediaType: string): string {
  if (mediaType === "image/jpeg") {return "jpg";}
  if (mediaType === "image/gif") {return "gif";}
  if (mediaType === "image/webp") {return "webp";}
  return "png";
}
